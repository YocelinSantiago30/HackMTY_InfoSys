// Políticas de referencia con nombre (courier/results_table_template.csv).
// Deciden con la misma información que el agente, pero sin reglas de
// seguridad ni valor de la zona de destino. Sus violaciones se cuentan igual.
const { VEHICLES } = require("./config");
const { toSeconds } = require("./world");
const { planTrip } = require("./trip");
const { decide: fastPathDecide } = require("./fastPath");

function economicsOf(request, ctx) {
  const now = toSeconds(request.sim_time);
  const trip = planTrip(request, {
    vehicle: request.vehicle,
    shocks: (ctx.shocks || []).filter((s) => s.start <= now),
    nowSeconds: now,
    courierZone: request.courier_state_overrides?.current_zone ?? null,
    inFlight: [],
  });
  const gross = Number(request.base_pay_mxn) * Number(request.surge_multiplier || 1) + Number(request.est_tip_mxn || 0);
  const net = gross - trip.km * VEHICLES[request.vehicle].fuelMxnPerKm;
  return { gross, net, rate: (net / Math.max(trip.totalMin, 1)) * 60 };
}

function response(request, decision, reason, bindingConstraint = null) {
  return { order_id: request.order_id, decision, reason, binding_constraint: bindingConstraint, tier: "tier1", degraded: false };
}

// Acepta todo lo que le ofrecen.
function acceptAll() {
  return {
    name: "AcceptAll",
    decide: (request) => response(request, "ACCEPT", "AcceptAll acepta todo pedido ofrecido."),
  };
}

// Acepta si el pago bruto está en el 25% más alto de lo visto en el turno.
function highestPay({ quantile = 0.75, warmup = 5 } = {}) {
  const seen = [];
  return {
    name: "HighestPay",
    decide: (request, ctx) => {
      const { gross } = economicsOf(request, ctx);
      const sorted = [...seen].sort((a, b) => a - b);
      seen.push(gross);
      const threshold = sorted.length < warmup ? 0 : sorted[Math.floor(quantile * (sorted.length - 1))];
      return gross >= threshold
        ? response(request, "ACCEPT", `Pago $${Math.round(gross)} ≥ percentil ${quantile * 100} ($${Math.round(threshold)}).`)
        : response(request, "SKIP", `Pago $${Math.round(gross)} < percentil ${quantile * 100} ($${Math.round(threshold)}).`, "reservation_wage");
    },
  };
}

// Acepta solo pickups cercanos.
function nearestFirst({ maxPickupKm = 2.5 } = {}) {
  return {
    name: "NearestFirst",
    decide: (request) =>
      Number(request.distance_pickup_km) <= maxPickupKm
        ? response(request, "ACCEPT", `Pickup a ${request.distance_pickup_km} km (≤ ${maxPickupKm} km).`)
        : response(request, "SKIP", `Pickup a ${request.distance_pickup_km} km (> ${maxPickupKm} km).`, "reservation_wage"),
  };
}

// Acepta si la tarifa por hora del pedido (sin mirar el destino) supera un umbral.
// El umbral se ajusta en seeds de entrenamiento (scripts/courier/train.js).
function greedyRate({ thresholdMxnHr }) {
  return {
    name: "GreedyRate",
    decide: (request, ctx) => {
      const { rate } = economicsOf(request, ctx);
      return rate >= thresholdMxnHr
        ? response(request, "ACCEPT", `$${Math.round(rate)}/h ≥ $${thresholdMxnHr}/h.`)
        : response(request, "SKIP", `$${Math.round(rate)}/h < $${thresholdMxnHr}/h.`, "reservation_wage");
    },
  };
}

// Acepta exactamente los pedidos de un plan precalculado (lo usa el Oracle).
function planPolicy(orderIds, name = "Oracle") {
  const plan = new Set(orderIds);
  return {
    name,
    decide: (request) =>
      plan.has(request.order_id)
        ? response(request, "ACCEPT", "Pedido incluido en el plan óptimo offline.")
        : response(request, "SKIP", "Pedido fuera del plan óptimo offline.", "reservation_wage"),
  };
}

// La misma baseline pero obligada a respetar las 5 reglas de seguridad del
// fast path. Sirve para comparar economía contra economía, sin que la
// baseline gane rompiendo reglas.
function withSafety(policy, { demandModel }) {
  const payOnly = { reservation_wage_mxn_hr: -Infinity, degraded: false };
  return {
    name: `${policy.name}+Safety`,
    decide: (request, ctx) => {
      const safetyCheck = fastPathDecide(request, { ...ctx, demandModel, strategy: payOnly }).response;
      return safetyCheck.decision === "SKIP" ? safetyCheck : policy.decide(request, ctx);
    },
  };
}

module.exports = {
  withSafety,
  acceptAll,
  highestPay,
  nearestFirst,
  greedyRate,
  planPolicy,
};
