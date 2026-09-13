// TIER 1 — fast path. Decide ACCEPT/SKIP para un pedido en microsegundos:
// - nunca llama a un modelo (presupuesto de 50 ms);
// - determinista: mismas entradas → misma decisión (no usa reloj ni azar);
// - seguridad primero (safety.js): el pago no puede revertir una negativa;
// - luego la economía: tarifa por hora ajustada por el valor de la zona de
//   destino contra el salario de reserva que fija el tier 2 (estrategia).
const { SAFETY_MARGIN_MIN, VEHICLES, MAX_IN_FLIGHT_ORDERS, ZONES } = require("./config");
const { toSeconds, round2, activeShocks, zone } = require("./world");
const { evaluateSafety } = require("./safety");
const { planTrip } = require("./trip");
const { zoneOutlook } = require("./demandModel");

const MAX_REASON_WORDS = 40;

function limitWords(text) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= MAX_REASON_WORDS ? words.join(" ") : `${words.slice(0, MAX_REASON_WORDS - 1).join(" ")}…`;
}

// Estado del repartidor al momento del ping: overrides del request > estado vivo.
function resolveCourierState(request, liveState) {
  const overrides = request.courier_state_overrides || {};
  const pick = (key, fallback) => (overrides[key] !== undefined ? overrides[key] : liveState?.[key] ?? fallback);

  const shiftEnd = pick("shift_end_time", null);
  if (!shiftEnd) throw new Error("No hay fin de turno: envía courier_state_overrides.shift_end_time o inicia un turno");

  return {
    continuous_riding_min: Number(pick("continuous_riding_min", 0)),
    shift_elapsed_hours: Number(pick("shift_elapsed_hours", 0)),
    last_break_end_time: pick("last_break_end_time", null),
    shift_end_time: shiftEnd,
    in_flight_orders: pick("in_flight_orders", []) || [],
    current_zone: pick("current_zone", null),
  };
}

// ctx: { strategy, demandModel, shocks (normalizados, conocidos al decidir), liveState }
function decide(request, ctx) {
  const vehicle = request.vehicle;
  if (!VEHICLES[vehicle]) throw new Error(`vehicle debe ser moto, car o bike (recibido: ${vehicle})`);
  zone(request.zone_pickup);
  zone(request.zone_dropoff);

  const state = resolveCourierState(request, ctx.liveState);
  const now = toSeconds(request.sim_time);
  const shiftEndSeconds = toSeconds(state.shift_end_time);
  const profile = VEHICLES[vehicle];
  const knownShocks = (ctx.shocks || []).filter((s) => s.start <= now);

  const trip = planTrip(request, {
    vehicle,
    shocks: knownShocks,
    nowSeconds: now,
    courierZone: state.current_zone,
    continuousRidingMin: state.continuous_riding_min,
    inFlight: state.in_flight_orders,
  });

  // --- economía (se calcula siempre, para poder explicar cualquier decisión)
  const gross = Number(request.base_pay_mxn) * Number(request.surge_multiplier || 1) + Number(request.est_tip_mxn || 0);
  const fuel = trip.km * profile.fuelMxnPerKm;
  const net = gross - fuel;
  const totalMin = Math.max(trip.totalMin, 1);
  const outlook = zoneOutlook(ctx.demandModel, vehicle, request.zone_dropoff, trip.dropoffSeconds);
  const nextDeadheadCost = outlook.expectedDeadheadKm * profile.fuelMxnPerKm;
  const rawRate = (net / totalMin) * 60;
  const adjustedRate = ((net - nextDeadheadCost) / (totalMin + outlook.expectedWaitMin)) * 60;
  const reservationWage = Number(ctx.strategy.reservation_wage_mxn_hr);

  const economics = {
    net_pay_mxn: round2(net),
    total_time_min: round2(totalMin),
    raw_rate_mxn_hr: round2(rawRate),
    adjusted_rate_mxn_hr: round2(adjustedRate),
    reservation_wage_mxn_hr: round2(reservationWage),
    deadhead_km: round2(trip.deadheadKm),
    gross_pay_mxn: round2(gross),
    fuel_cost_mxn: round2(fuel),
    dropoff_expected_wait_min: outlook.expectedWaitMin,
    dropoff_expected_deadhead_km: outlook.expectedDeadheadKm,
  };

  const safety = evaluateSafety(trip, { shiftEndSeconds, vehicle }, SAFETY_MARGIN_MIN);
  const dropoffName = ZONES.find((z) => z.id === Number(request.zone_dropoff)).name;

  let decision;
  let bindingConstraint;
  let reason;
  if (safety.length > 0) {
    decision = "SKIP";
    bindingConstraint = safety[0].constraint;
    reason = safety[0].reason;
  } else if (state.in_flight_orders.length >= MAX_IN_FLIGHT_ORDERS) {
    decision = "SKIP";
    bindingConstraint = null;
    reason = `Ya lleva ${state.in_flight_orders.length} pedidos en curso; el máximo apilable es ${MAX_IN_FLIGHT_ORDERS}.`;
  } else if (trip.lateOrders.length > 0) {
    decision = "SKIP";
    bindingConstraint = null;
    reason = `Apilar no es factible: ${trip.lateOrders.join(", ")} llegaría después de su hora prometida en cualquier orden de paradas.`;
  } else if (round2(adjustedRate) >= round2(reservationWage)) {
    // Empate exacto (a centavos) = ACCEPT: regla fija y reproducible.
    decision = "ACCEPT";
    bindingConstraint = null;
    reason = `$${Math.round(adjustedRate)}/h ajustado ≥ reserva $${Math.round(reservationWage)}/h: neto $${Math.round(net)} en ${Math.round(totalMin)} min; en ${dropoffName} el siguiente pedido llega en ~${Math.round(outlook.expectedWaitMin)} min.`;
  } else {
    decision = "SKIP";
    bindingConstraint = "reservation_wage";
    reason = `$${Math.round(adjustedRate)}/h ajustado < reserva $${Math.round(reservationWage)}/h: neto $${Math.round(net)} en ${Math.round(totalMin)} min; terminar en ${dropoffName} deja ~${Math.round(outlook.expectedWaitMin)} min sin pedido.`;
  }

  const alternatives =
    decision === "ACCEPT"
      ? [
          {
            option: "SKIP y seguir libre",
            rejected_because: `Aceptar rinde $${Math.round(adjustedRate)}/h contando la espera en ${dropoffName}, por encima de la reserva de $${Math.round(reservationWage)}/h.`,
          },
        ]
      : [{ option: "ACCEPT", rejected_because: limitWords(reason) }];
  for (const alt of trip.alternatives || []) {
    alternatives.push({
      option: `Apilar en orden ${alt.sequence}`,
      rejected_because: alt.lateOrders.length
        ? `llegaría tarde: ${alt.lateOrders.join(", ")}`
        : `termina en ${alt.completion} min, después del orden elegido`,
    });
  }

  return {
    response: {
      order_id: request.order_id,
      decision,
      reason: limitWords(reason),
      binding_constraint: bindingConstraint,
      tier: "tier1",
      degraded: Boolean(ctx.strategy.degraded),
      economics,
    },
    explain: {
      order_id: request.order_id,
      decision,
      reason: limitWords(reason),
      inputs: {
        request,
        courier_state: state,
        sim_time: request.sim_time,
        time_remaining_min: round2((shiftEndSeconds - now) / 60),
        time_to_completion_min: round2((trip.completionSeconds - now) / 60),
        predicted_dropoff_time: new Date(trip.dropoffSeconds * 1000).toISOString().slice(0, 19),
        trip: { ...trip, alternatives: undefined },
        active_shocks: activeShocks(knownShocks, now).map(({ start, end, ...s }) => s),
        strategy: ctx.strategy,
        safety_checks: safety,
        safety_margin_min: SAFETY_MARGIN_MIN,
        economics,
      },
      alternatives_considered: alternatives,
    },
  };
}

module.exports = {
  decide,
  resolveCourierState,
  MAX_REASON_WORDS,
};
