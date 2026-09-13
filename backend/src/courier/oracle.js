// Oracle: solver offline con conocimiento total del flujo de pedidos y de
// los shocks. Da la cota superior de la tabla de resultados.
//
// Programación dinámica exacta sobre (pedido, zona desde la que se toma):
// el repartidor solo recibe ofertas estando libre y dentro del radio, igual
// que en el simulador. Respeta capacidad, zonas marcadas y fin de turno; las
// reglas de conducción continua se RELAJAN (por eso es una cota superior).
const { VEHICLES, ZONES } = require("./config");
const { generateShift } = require("./orderStream");
const { toSeconds, zoneDistanceKm, normalizeShock } = require("./world");
const { planTrip } = require("./trip");
const { evaluateSafety } = require("./safety");

const RIDING_RULES = new Set(["mandatory_break", "heat_rule"]);

function solveOracle(config) {
  const shift = generateShift(config);
  const cfg = shift.config;
  const profile = VEHICLES[cfg.vehicle];
  const shocks = shift.shocks.map(normalizeShock);

  // Nodos ya completados: { completion, zone, value, orderId, prev }
  const start = { completion: cfg.startSeconds, zone: cfg.start_location_zone, value: 0, orderId: null, prev: null };
  const nodes = [start];

  for (const order of shift.orders) {
    const t = toSeconds(order.sim_time);
    for (const from of ZONES) {
      // Mejor forma de estar libre en `from` a tiempo para esta oferta.
      let best = null;
      for (const node of nodes) {
        if (node.zone === from.id && node.completion <= t && (!best || node.value > best.value)) best = node;
      }
      if (!best) continue;

      const pickupKm = zoneDistanceKm(from.id, order.zone_pickup);
      if (pickupKm > profile.offerRadiusKm) continue;

      const request = { ...order, distance_pickup_km: pickupKm };
      const trip = planTrip(request, { vehicle: cfg.vehicle, shocks, nowSeconds: t, courierZone: from.id, inFlight: [] });
      const hardViolations = evaluateSafety(trip, { shiftEndSeconds: cfg.endSeconds, vehicle: cfg.vehicle }, 0).filter(
        (v) => !RIDING_RULES.has(v.constraint)
      );
      if (hardViolations.length) continue;

      const gross = Number(order.base_pay_mxn) * Number(order.surge_multiplier) + Number(order.est_tip_mxn || 0);
      const net = gross - trip.km * profile.fuelMxnPerKm;
      if (net <= 0) continue;

      nodes.push({ completion: trip.completionSeconds, zone: order.zone_dropoff, value: best.value + net, orderId: order.order_id, prev: best });
    }
  }

  const final = nodes.reduce((a, b) => (b.value > a.value ? b : a));
  const plan = [];
  for (let node = final; node && node.orderId; node = node.prev) plan.unshift(node.orderId);
  return { plan, value: final.value };
}

module.exports = {
  solveOracle,
};
