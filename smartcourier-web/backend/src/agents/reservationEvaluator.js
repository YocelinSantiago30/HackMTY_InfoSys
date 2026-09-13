// Reserva una sola entrega siguiente sin desviar ni retrasar la ruta actual.
// El límite de traslado vacío excluye la entrega pagada; su costo sí se cobra
// completo al calcular el beneficio. No consulta pedidos futuros.
const { checkHardConstraints } = require('./smartCourierAgent');
const { MAX_ORDERS_IN_ROUTE, DEFAULT_BATCH_LIMITS } = require('./batchEvaluator');

function evaluateReservation({ order, activeOrders, current, tail, durationSeconds, costPerKm, preferences = {}, limits = DEFAULT_BATCH_LIMITS }) {
  const additionalCost = tail.totalKm * costPerKm;
  const netProfit = Number(order.final_payment) - additionalCost;
  const minutes = (tail.endSecond - current.endSecond) / 60;
  const rate = netProfit / Math.max(minutes, 1);
  const pickupKm = tail.legs[0].distanceKm;
  const restrictions = checkHardConstraints({ order, preferences, metrics: { netProfit, operatingCost: additionalCost } });
  if (![netProfit, minutes, pickupKm, costPerKm].every(Number.isFinite) || minutes < 0 || pickupKm < 0 || costPerKm < 0) {
    restrictions.push({ code: 'INVALID_RESERVATION', message: 'No hay una estimación válida para reservar esta entrega' });
  }
  if (activeOrders.length >= MAX_ORDERS_IN_ROUTE) restrictions.push({ code: 'MAX_ORDERS_IN_ROUTE', message: 'Ya hay un pedido reservado' });
  const weight = [...activeOrders, order].reduce((sum, o) => sum + Number(o.package_weight || 0), 0);
  if (preferences.bag_max_weight != null && weight > Number(preferences.bag_max_weight)) {
    restrictions.push({ code: 'COMBINED_WEIGHT_EXCEEDED', message: 'Los pedidos exceden la capacidad configurada' });
  }
  if (tail.endSecond > durationSeconds) restrictions.push({ code: 'RESERVATION_AFTER_SHIFT', message: 'La entrega reservada no termina dentro del turno' });
  if (pickupKm > limits.maxExtraKm || minutes > limits.maxExtraMinutes) {
    restrictions.push({ code: 'RESERVATION_TOO_FAR', message: `La reserva supera ${limits.maxExtraKm} km de traslado vacío o ${limits.maxExtraMinutes} minutos adicionales` });
  }
  if (rate < limits.minMarginalProfitPerMinute) restrictions.push({ code: 'RESERVATION_NOT_PROFITABLE', message: `La reserva no alcanza $${limits.minMarginalProfitPerMinute} netos por minuto adicional` });
  const round = x => Number(x.toFixed(2));
  return { compatible: restrictions.length === 0, restrictions, impact: {
    strategy: 'NEXT_ORDER', additionalDistance: round(tail.totalKm), emptyPickupKm: round(pickupKm),
    additionalTime: round(minutes), additionalRevenue: Number(order.final_payment), additionalCost: round(additionalCost),
    additionalNetProfit: round(netProfit), marginalProfitPerMinute: round(rate),
    maxLateMinutesVsPromise: 0, addedDelayToCurrentMinutes: 0,
    promisedDropoffSecond: tail.endSecond,
  } };
}

module.exports = { evaluateReservation };
