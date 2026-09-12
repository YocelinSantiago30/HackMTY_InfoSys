// Evalúa si un pedido nuevo puede agruparse con el pedido activo del
// repartidor (sección 10). Solo se invoca cuando SmartCourier está
// "ocupado" (ver smartCourierAgent.js) — Baseline nunca llega aquí.
//
// batchedRouteDistance viene de una de dos fuentes:
// - routeOptimization (FASE 22): resultado ya calculado por
//   optimization-service (OR-Tools) con el orden verdadero óptimo de
//   paradas, respetando que cada recolección va antes que su propia entrega.
// - Si no está disponible (servicio caído): heurística de respaldo con la
//   forma fija pickup1 -> pickup2 -> dropoff2 -> dropoff1.
// Sigue siendo una función pura: no hace la llamada HTTP ella misma, solo
// recibe el resultado ya resuelto por quien la invoca (sección 58: testable).

const { haversineDistanceKm } = require("../utils/geo");
const { AVERAGE_SPEED_KMH, STREET_FACTOR } = require("../services/routing.service");

const MAX_BATCH_PICKUP_DISTANCE_KM = 2;
const MAX_BATCH_DROPOFF_DISTANCE_KM = 3;

function toNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function evaluateBatch({ activeOrder, newOrder, preferences = {}, simulation = {}, routeOptimization = null }) {
  const restrictions = [];

  const pickupDistanceKm = haversineDistanceKm(
    Number(activeOrder.pickup_lat),
    Number(activeOrder.pickup_lng),
    Number(newOrder.pickup_lat),
    Number(newOrder.pickup_lng)
  );

  const dropoffDistanceKm = haversineDistanceKm(
    Number(activeOrder.dropoff_lat),
    Number(activeOrder.dropoff_lng),
    Number(newOrder.dropoff_lat),
    Number(newOrder.dropoff_lng)
  );

  if (pickupDistanceKm > MAX_BATCH_PICKUP_DISTANCE_KM) {
    restrictions.push({
      code: "PICKUP_TOO_FAR",
      message: `El punto de recolección está a ${pickupDistanceKm.toFixed(1)}km del pedido activo (máximo para agrupar: ${MAX_BATCH_PICKUP_DISTANCE_KM}km)`,
    });
  }

  if (dropoffDistanceKm > MAX_BATCH_DROPOFF_DISTANCE_KM) {
    restrictions.push({
      code: "DROPOFF_TOO_FAR",
      message: `El destino está a ${dropoffDistanceKm.toFixed(1)}km del destino del pedido activo (máximo para agrupar: ${MAX_BATCH_DROPOFF_DISTANCE_KM}km)`,
    });
  }

  const bagMaxWeight = toNumber(preferences.bag_max_weight, null);
  const combinedWeight = Number(activeOrder.package_weight) + Number(newOrder.package_weight);
  if (bagMaxWeight !== null && combinedWeight > bagMaxWeight) {
    restrictions.push({
      code: "COMBINED_WEIGHT_EXCEEDED",
      message: `El peso combinado (${combinedWeight.toFixed(2)}kg) excede la capacidad de la mochila (${bagMaxWeight}kg)`,
    });
  }

  // originalRouteDistance viene de OSRM/fallback (distancia real de calles).
  // Si hay resultado de OR-Tools úsalo (ya es el orden óptimo de paradas);
  // si no, heurística de respaldo con la forma fija de ruta, aplicando el
  // mismo factor de calle que el resto del sistema (sección 15) para no
  // comparar manzanas con naranjas: distancia real vs. línea recta sin ajustar.
  const originalRouteDistance = Number(activeOrder.distance_km);
  const usedOptimizer = Boolean(routeOptimization?.success);
  const batchedRouteDistance = usedOptimizer
    ? routeOptimization.totalDistanceKm
    : pickupDistanceKm * STREET_FACTOR + Number(newOrder.distance_km) + dropoffDistanceKm * STREET_FACTOR;
  const additionalDistance = Number((batchedRouteDistance - originalRouteDistance).toFixed(3));
  const additionalTime = Number(((additionalDistance / AVERAGE_SPEED_KMH) * 60).toFixed(2));
  const additionalRevenue = Number(newOrder.final_payment);

  const durationSeconds = simulation?.simulation_duration_seconds;
  if (durationSeconds) {
    const remainingSeconds = durationSeconds - newOrder.created_at_simulation_second;
    if (additionalTime * 60 > remainingSeconds) {
      restrictions.push({
        code: "INSUFFICIENT_SHIFT_TIME_FOR_BATCH",
        message: `El desvío adicional (${additionalTime.toFixed(1)} min) no cabe en el tiempo restante del turno (${(remainingSeconds / 60).toFixed(1)} min)`,
      });
    }
  }

  return {
    compatible: restrictions.length === 0,
    restrictions,
    impact: {
      pickupDistanceKm: Number(pickupDistanceKm.toFixed(3)),
      dropoffDistanceKm: Number(dropoffDistanceKm.toFixed(3)),
      originalRouteDistance,
      batchedRouteDistance: Number(batchedRouteDistance.toFixed(3)),
      additionalDistance,
      additionalTime,
      additionalRevenue,
      routeSource: usedOptimizer ? "OPTIMIZED" : "HEURISTIC",
      stopOrder: usedOptimizer ? routeOptimization.order : null,
    },
  };
}

module.exports = {
  evaluateBatch,
  MAX_BATCH_PICKUP_DISTANCE_KM,
  MAX_BATCH_DROPOFF_DISTANCE_KM,
};
