// Evalúa si SmartCourier, estando ocupado, debe agregar un pedido nuevo a su
// ruta actual (sección 10). Compara la ruta que seguiría sin el pedido contra
// la mejor ruta con él, en términos marginales, y valida los retrasos contra
// la HORA COMPROMETIDA de cada pedido (no contra una ruta recalculada, que
// ya podría venir atrasada por tráfico). Baseline nunca llega aquí.
//
// Función pura: no toca la base de datos (sección 58: testable).

const MAX_ORDERS_IN_ROUTE = 2;

// Un batch es un desvío corto sobre la ruta actual, no una cola de pedidos.
// Calibrados con scripts/compareStrategies.js (seeds de entrenamiento).
const DEFAULT_BATCH_LIMITS = {
  promiseToleranceMinutes: 10, // cuánto puede llegar tarde un pedido ya prometido por agrupar
  maxExtraMinutes: 20,
  maxExtraKm: 6,
  minMarginalProfitPerMinute: 3, // MXN netos por minuto extra
};

function round2(value) {
  return Number(Number(value).toFixed(2));
}

// current / candidate: { endSecond, remainingKm, dropoffSeconds: { [orderNumber]: second } }
// promises: { [orderNumber]: promisedDropoffSecond } de los pedidos ya aceptados
function evaluateBatch({
  newOrder,
  activeOrders,
  current,
  candidate,
  promises = {},
  costPerKm,
  preferences = {},
  limits = DEFAULT_BATCH_LIMITS,
}) {
  const restrictions = [];

  if (activeOrders.length >= MAX_ORDERS_IN_ROUTE) {
    restrictions.push({
      code: "MAX_ORDERS_IN_ROUTE",
      message: `Ya lleva ${activeOrders.length} pedidos en ruta (máximo ${MAX_ORDERS_IN_ROUTE})`,
    });
  }

  const bagMaxWeight =
    preferences.bag_max_weight === null || preferences.bag_max_weight === undefined ? null : Number(preferences.bag_max_weight);
  const combinedWeight = [...activeOrders, newOrder].reduce((sum, o) => sum + Number(o.package_weight || 0), 0);
  if (bagMaxWeight !== null && combinedWeight > bagMaxWeight) {
    restrictions.push({
      code: "COMBINED_WEIGHT_EXCEEDED",
      message: `El peso combinado (${combinedWeight.toFixed(2)}kg) excede la capacidad de la mochila (${bagMaxWeight}kg)`,
    });
  }

  if (!candidate) {
    restrictions.push({
      code: "BATCH_BREAKS_PROMISE",
      message: `Ningún orden de paradas entrega los pedidos aceptados dentro de su hora comprometida (+${limits.promiseToleranceMinutes} min)`,
    });
    return { compatible: false, restrictions, impact: {} };
  }

  const additionalDistance = candidate.remainingKm - current.remainingKm;
  const additionalMinutes = (candidate.endSecond - current.endSecond) / 60;
  const additionalCost = additionalDistance * costPerKm;
  const additionalNetProfit = Number(newOrder.final_payment) - additionalCost;
  const marginalProfitPerMinute = additionalNetProfit / Math.max(additionalMinutes, 1);

  const lateness = Object.entries(promises).map(([orderNumber, promised]) => {
    const arrival = candidate.dropoffSeconds[orderNumber];
    return arrival === undefined ? 0 : (arrival - promised) / 60;
  });
  const maxLateMinutes = Math.max(0, ...lateness);

  if (maxLateMinutes > limits.promiseToleranceMinutes) {
    restrictions.push({
      code: "BATCH_BREAKS_PROMISE",
      message: `Un pedido ya aceptado llegaría ${maxLateMinutes.toFixed(1)} min después de su hora comprometida (tolerancia ${limits.promiseToleranceMinutes})`,
    });
  }

  if (additionalMinutes > limits.maxExtraMinutes || additionalDistance > limits.maxExtraKm) {
    restrictions.push({
      code: "BATCH_DETOUR_TOO_LONG",
      message: `El desvío agrega ${additionalMinutes.toFixed(1)} min y ${additionalDistance.toFixed(1)} km (máximo ${limits.maxExtraMinutes} min / ${limits.maxExtraKm} km)`,
    });
  }

  if (marginalProfitPerMinute < limits.minMarginalProfitPerMinute) {
    restrictions.push({
      code: "BATCH_NOT_PROFITABLE",
      message: `Agrupar deja $${additionalNetProfit.toFixed(2)} netos por ${additionalMinutes.toFixed(1)} min extra ($${marginalProfitPerMinute.toFixed(2)}/min, mínimo $${limits.minMarginalProfitPerMinute}/min)`,
    });
  }

  return {
    compatible: restrictions.length === 0,
    restrictions,
    impact: {
      additionalDistance: round2(additionalDistance),
      additionalTime: round2(additionalMinutes),
      additionalRevenue: round2(newOrder.final_payment),
      additionalCost: round2(additionalCost),
      additionalNetProfit: round2(additionalNetProfit),
      marginalProfitPerMinute: round2(marginalProfitPerMinute),
      maxLateMinutesVsPromise: round2(maxLateMinutes),
      promisedDropoffSecond: candidate.dropoffSeconds[newOrder.external_order_number] ?? null,
    },
  };
}

module.exports = {
  evaluateBatch,
  MAX_ORDERS_IN_ROUTE,
  DEFAULT_BATCH_LIMITS,
};
