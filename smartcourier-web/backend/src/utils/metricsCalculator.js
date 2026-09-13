// Calcula las métricas derivadas (sección 28) a partir de los contadores
// crudos de agent_states. Función pura: no toca la base de datos, así se
// puede probar de forma aislada (sección 58).
//
// totalEarnings es la ganancia NETA (ingresos cobrados - costo operativo):
// es lo que realmente gana el repartidor y lo que se compara entre agentes.

function toNumber(value) {
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function safeDivide(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function computeMetrics({ agentState, elapsedMinutes }) {
  const grossEarnings = toNumber(agentState.earnings);
  const operatingCost = toNumber(agentState.operating_cost);
  const totalEarnings = grossEarnings - operatingCost;
  const acceptedOrders = toNumber(agentState.accepted_orders);
  const rejectedOrders = toNumber(agentState.rejected_orders);
  const completedOrders = toNumber(agentState.completed_orders);
  const cancelledOrders = toNumber(agentState.cancelled_orders);
  const expiredOrders = toNumber(agentState.expired_orders);
  const distanceKm = toNumber(agentState.distance_km);
  const activeMinutes = toNumber(agentState.active_minutes);
  const batchedOrders = toNumber(agentState.batched_orders);
  const repositions = toNumber(agentState.repositions);
  const lateDeliveries = toNumber(agentState.late_deliveries);
  const totalDelayMinutes = toNumber(agentState.total_delay_minutes);
  const totalEtaErrorMinutes = toNumber(agentState.total_eta_error_minutes);
  const overtimeMinutes = toNumber(agentState.overtime_minutes);

  const totalMinutes = Math.max(0, toNumber(elapsedMinutes));
  // Hora REAL trabajada: el turno transcurrido más el tiempo extra que tomó
  // terminar las entregas en curso al cerrarlo.
  const workedMinutes = totalMinutes + overtimeMinutes;
  const idleMinutes = Number(Math.max(0, totalMinutes - activeMinutes).toFixed(2));
  const offeredOrders = acceptedOrders + rejectedOrders;

  // "Porcentaje de utilización del turno" (sección 1). Se acota a 100 porque
  // las entregas en curso al cerrar el turno se terminan después de la hora.
  const efficiencyScore = Math.min(100, safeDivide(activeMinutes, totalMinutes) * 100);

  return {
    totalEarnings: Number(totalEarnings.toFixed(2)),
    grossEarnings: Number(grossEarnings.toFixed(2)),
    operatingCost: Number(operatingCost.toFixed(2)),
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
    averageOrderPayment: safeDivide(grossEarnings, completedOrders),
    acceptanceRate: safeDivide(acceptedOrders, offeredOrders) * 100,
    completionRate: safeDivide(completedOrders, acceptedOrders) * 100,
    averageDeliveryTime: safeDivide(activeMinutes, completedOrders),
    batchedOrders,
    repositions,
    efficiencyScore: Number(efficiencyScore.toFixed(2)),
    overtimeMinutes: Number(overtimeMinutes.toFixed(2)),
    workedMinutes: Number(workedMinutes.toFixed(2)),
    netPerWorkedHour: safeDivide(totalEarnings * 60, workedMinutes),
    lateDeliveries,
    lateRate: safeDivide(lateDeliveries, completedOrders) * 100,
    averageDelayMinutes: safeDivide(totalDelayMinutes, completedOrders),
    averageEtaErrorMinutes: safeDivide(totalEtaErrorMinutes, completedOrders),
  };
}

module.exports = {
  computeMetrics,
};
