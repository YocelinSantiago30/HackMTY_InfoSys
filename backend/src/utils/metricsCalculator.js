// Calcula las métricas derivadas (sección 28) a partir de los contadores
// crudos de agent_states. Función pura: no toca la base de datos, así se
// puede probar de forma aislada (sección 58).

function toNumber(value) {
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function computeMetrics({ agentState, elapsedMinutes }) {
  const totalEarnings = toNumber(agentState.earnings);
  const acceptedOrders = toNumber(agentState.accepted_orders);
  const rejectedOrders = toNumber(agentState.rejected_orders);
  const completedOrders = toNumber(agentState.completed_orders);
  const cancelledOrders = toNumber(agentState.cancelled_orders);
  const expiredOrders = toNumber(agentState.expired_orders);
  const distanceKm = toNumber(agentState.distance_km);
  const activeMinutes = toNumber(agentState.active_minutes);
  const batchedOrders = toNumber(agentState.batched_orders);
  const repositions = toNumber(agentState.repositions);

  const totalMinutes = Math.max(0, toNumber(elapsedMinutes));
  const idleMinutes = Number(Math.max(0, totalMinutes - activeMinutes).toFixed(2));

  const offeredOrders = acceptedOrders + rejectedOrders;

  // "Porcentaje de utilización del turno" (sección 1) — cuánto del tiempo
  // disponible se pasó activo (entregando) en vez de ocioso.
  // Se acota a 100: sin un motor de movimiento que ocupe al repartidor
  // mientras dura cada entrega, activeMinutes (tiempo estimado acumulado de
  // los pedidos aceptados) puede superar el tiempo real transcurrido —
  // matemáticamente daría más de 100% de utilización, que no tiene sentido.
  const efficiencyScore = Math.min(100, safeDivide(activeMinutes, totalMinutes) * 100);

  return {
    totalEarnings: Number(totalEarnings.toFixed(2)),
    acceptedOrders,
    rejectedOrders,
    completedOrders,
    cancelledOrders,
    expiredOrders,
    distanceKm: Number(distanceKm.toFixed(3)),
    activeMinutes: Number(activeMinutes.toFixed(2)),
    idleMinutes,
    totalMinutes: Number(totalMinutes.toFixed(2)),
    earningsPerMinute: safeDivide(totalEarnings, totalMinutes),
    earningsPerActiveMinute: safeDivide(totalEarnings, activeMinutes),
    earningsPerKm: safeDivide(totalEarnings, distanceKm),
    averageOrderPayment: safeDivide(totalEarnings, completedOrders),
    acceptanceRate: safeDivide(acceptedOrders, offeredOrders) * 100,
    completionRate: safeDivide(completedOrders, acceptedOrders) * 100,
    averageDeliveryTime: safeDivide(activeMinutes, completedOrders),
    batchedOrders,
    repositions,
    efficiencyScore: Number(efficiencyScore.toFixed(2)),
  };
}

module.exports = {
  computeMetrics,
};
