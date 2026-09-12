// Agente principal. A diferencia de baselineAgent (reglas de umbral fijas),
// SmartCourier evalúa un score compuesto 0-100 (sección 7) DESPUÉS de pasar
// una capa de restricciones duras que puede vetar cualquier pedido sin
// importar qué tan rentable sea (sección 6).
//
// Cuando el agente tiene un pedido activo (ver batchEvaluator.js, FASE 21),
// la decisión no pasa por el score de esta sección — se evalúa como BATCH
// con su propio checklist (sección 10), o REJECT si no es compatible.
// ROUTE_COMPATIBILITY/BATCH_COMPATIBILITY/DETOUR (sección 7) no se agregan
// como factores continuos del score normal porque, cuando el agente está
// libre, no hay "ruta activa" con la cual comparar — serían siempre cero,
// puro relleno sin información real.
//
// Restricciones aún no implementadas (documentado, no simulado):
// avoided_zones (siempre vacío hasta que exista un editor de zonas) y
// "pedido expirado" (los agentes evalúan en el mismo instante en que se
// genera el pedido, nunca hay ventana de expiración real todavía).
//
// Función pura a propósito: no toca la base de datos (sección 58: testable).

const { haversineDistanceKm } = require("../utils/geo");
const { simulatedHourOfDay } = require("../simulation/simulatedTime");
const { DEFAULTS } = require("./baselineAgent");
const { evaluateBatch } = require("./batchEvaluator");

// Pesos de cada factor, en puntos (sección 7: "los pesos deberán
// almacenarse en configuración"). Justificación: PROFITABILITY concentra
// el mayor peso porque el mandato central del agente es maximizar ganancias
// (sección 1); el resto son consideraciones secundarias de un buen
// repartidor, ninguna domina por sí sola. Las penalizaciones máximas suman
// 50 puntos: ni siquiera la peor combinación de riesgos puede, por sí sola,
// hundir un pedido excelente por debajo de la banda EVALUATE (100-50=50) —
// las restricciones duras siguen siendo el único veto absoluto.
const WEIGHTS = {
  profitability: 35,
  timeEfficiency: 15,
  distanceEfficiency: 15,
  destinationDemand: 15,
  surge: 10,
  shiftImpact: 10,
  trafficPenalty: 15,
  lowDemandPenalty: 10,
  timeRiskPenalty: 10,
  routeRiskPenalty: 10,
};

const ACCEPT_THRESHOLD = 70;
// Sección 7 llama "EVALUATE" a la banda 50-69, pero ese no es un valor de
// decisión válido (sección 5). Se mapea a WAIT ("esperar mejores
// oportunidades"), la opción semánticamente más cercana.
const WAIT_THRESHOLD = 50;

const DEMAND_FRACTIONS = { LOW: 0, MEDIUM: 0.4, HIGH: 0.7, VERY_HIGH: 1.0 };
const TRAFFIC_FRACTIONS = { LOW: 0, MEDIUM: 0.3, HIGH: 0.7, SEVERE: 1.0 };

const REFERENCE_SPEED_KM_PER_MIN = 0.5; // ~30 km/h de referencia urbana
const REFERENCE_TOTAL_MINUTES = 30; // preparación + entrega "normal"
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

function toNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round2(value) {
  return Number(value.toFixed(2));
}

function checkHardConstraints({ order, preferences }) {
  const restrictions = [];

  const bagMaxWeight = toNumber(preferences.bag_max_weight, null);
  if (bagMaxWeight !== null && order.package_weight > bagMaxWeight) {
    restrictions.push({
      code: "BAG_CAPACITY_EXCEEDED",
      message: `El paquete (${order.package_weight}kg) excede la capacidad de la mochila configurada (${bagMaxWeight}kg)`,
    });
  }

  const nightLimit = toNumber(preferences.night_distance_limit_km, null);
  if (nightLimit !== null) {
    const hour = simulatedHourOfDay(order.created_at_simulation_second);
    const isNight = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
    if (isNight && order.distance_km > nightLimit) {
      restrictions.push({
        code: "NIGHT_DISTANCE_LIMIT_EXCEEDED",
        message: `Distancia (${order.distance_km}km) excede el límite nocturno configurado (${nightLimit}km) a las ${hour}:00`,
      });
    }
  }

  const workZoneRadius = toNumber(preferences.work_zone_radius_km, null);
  const workZoneLat = toNumber(preferences.work_zone_center_lat, null);
  const workZoneLng = toNumber(preferences.work_zone_center_lng, null);
  if (workZoneRadius !== null && workZoneLat !== null && workZoneLng !== null) {
    const distanceFromCenter = haversineDistanceKm(
      workZoneLat,
      workZoneLng,
      order.pickup_lat,
      order.pickup_lng
    );
    if (distanceFromCenter > workZoneRadius) {
      restrictions.push({
        code: "OUTSIDE_WORK_ZONE",
        message: `El punto de recolección está a ${distanceFromCenter.toFixed(1)}km del centro de tu zona de trabajo (radio configurado: ${workZoneRadius}km)`,
      });
    }
  }

  return restrictions;
}

function checkShiftTimeConstraint({ order, simulation }) {
  const durationSeconds = simulation?.simulation_duration_seconds;
  if (!durationSeconds) return null;

  const remainingSeconds = durationSeconds - order.created_at_simulation_second;
  const orderSeconds = order.estimated_time_minutes * 60;

  if (orderSeconds > remainingSeconds) {
    return {
      code: "INSUFFICIENT_SHIFT_TIME",
      message: `El pedido requiere ${order.estimated_time_minutes} min pero solo quedan ${(remainingSeconds / 60).toFixed(1)} min de turno`,
    };
  }

  return null;
}

function computeScore({ order, preferences, simulation }) {
  const paymentPerMinute = order.final_payment / order.estimated_time_minutes;
  const paymentPerKm = order.final_payment / order.distance_km;

  const minPerMinute = toNumber(preferences.minimum_payment_per_minute, DEFAULTS.minimumPaymentPerMinute);
  const minPerKm = toNumber(preferences.minimum_payment_per_km, DEFAULTS.minimumPaymentPerKm);
  const maxDistance = toNumber(preferences.maximum_distance_km, DEFAULTS.maximumDistanceKm);

  // PROFITABILITY: cuánto por encima del mínimo configurado paga el pedido,
  // normalizado a un techo de 3x el mínimo (a partir de ahí, puntaje completo).
  const perMinuteRatio = clamp01((paymentPerMinute - minPerMinute) / (minPerMinute * 2 || 1));
  const perKmRatio = clamp01((paymentPerKm - minPerKm) / (minPerKm * 2 || 1));
  const profitabilityScore = ((perMinuteRatio + perKmRatio) / 2) * WEIGHTS.profitability;

  // TIME_EFFICIENCY: velocidad efectiva (km/min) — menos tiempo perdido en
  // tráfico/espera por kilómetro recorrido.
  const speedKmPerMin = order.distance_km / order.estimated_time_minutes;
  const timeEfficiencyScore = clamp01(speedKmPerMin / REFERENCE_SPEED_KM_PER_MIN) * WEIGHTS.timeEfficiency;

  // DISTANCE_EFFICIENCY: viajes cortos respecto al máximo configurado.
  const distanceEfficiencyScore = clamp01(1 - order.distance_km / maxDistance) * WEIGHTS.distanceEfficiency;

  // DESTINATION_DEMAND: terminar en una zona de alta demanda facilita
  // encontrar el siguiente pedido.
  const destinationDemandScore =
    (DEMAND_FRACTIONS[order.destination_demand] ?? 0.4) * WEIGHTS.destinationDemand;

  // SURGE: multiplicador de pago por encima de lo normal (rango 1.0-2.0).
  const surgeScore = clamp01((order.surge_multiplier - 1) / 1) * WEIGHTS.surge;

  // SHIFT_IMPACT: qué tan poco consume este pedido del tiempo restante del turno.
  let shiftImpactScore = WEIGHTS.shiftImpact;
  const durationSeconds = simulation?.simulation_duration_seconds;
  if (durationSeconds) {
    const remainingBefore = durationSeconds - order.created_at_simulation_second;
    const orderSeconds = order.estimated_time_minutes * 60;
    shiftImpactScore = clamp01(1 - orderSeconds / Math.max(remainingBefore, 1)) * WEIGHTS.shiftImpact;
  }

  // Penalizaciones
  const trafficPenalty = (TRAFFIC_FRACTIONS[order.traffic_level] ?? 0) * WEIGHTS.trafficPenalty;
  const lowDemandPenalty = order.destination_demand === "LOW" ? WEIGHTS.lowDemandPenalty : 0;

  const totalMinutes = (order.estimated_preparation_minutes || 0) + order.estimated_time_minutes;
  const timeRiskPenalty =
    clamp01((totalMinutes - REFERENCE_TOTAL_MINUTES) / REFERENCE_TOTAL_MINUTES) * WEIGHTS.timeRiskPenalty;

  const routeRiskPenalty = order.route_source === "ESTIMATED" ? WEIGHTS.routeRiskPenalty : 0;

  const positiveFactors = [
    { factor: "PROFITABILITY", points: round2(profitabilityScore) },
    { factor: "TIME_EFFICIENCY", points: round2(timeEfficiencyScore) },
    { factor: "DISTANCE_EFFICIENCY", points: round2(distanceEfficiencyScore) },
    { factor: "DESTINATION_DEMAND", points: round2(destinationDemandScore) },
    { factor: "SURGE", points: round2(surgeScore) },
    { factor: "SHIFT_IMPACT", points: round2(shiftImpactScore) },
  ];

  const negativeFactors = [
    { factor: "TRAFFIC", points: round2(-trafficPenalty) },
    { factor: "LOW_DEMAND", points: round2(-lowDemandPenalty) },
    { factor: "TIME_RISK", points: round2(-timeRiskPenalty) },
    { factor: "ROUTE_RISK", points: round2(-routeRiskPenalty) },
  ].filter((factor) => factor.points !== 0);

  const rawScore =
    profitabilityScore +
    timeEfficiencyScore +
    distanceEfficiencyScore +
    destinationDemandScore +
    surgeScore +
    shiftImpactScore -
    trafficPenalty -
    lowDemandPenalty -
    timeRiskPenalty -
    routeRiskPenalty;

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  return { score, positiveFactors, negativeFactors };
}

function evaluateSmartCourier({
  order,
  preferences = {},
  simulation = {},
  activeOrder = null,
  routeOptimization = null,
}) {
  if (activeOrder) {
    const batchResult = evaluateBatch({
      activeOrder,
      newOrder: order,
      preferences,
      simulation,
      routeOptimization,
    });

    if (batchResult.compatible) {
      return {
        decision: "BATCH",
        score: null,
        positiveFactors: [],
        negativeFactors: [],
        restrictions: [],
        estimatedImpact: batchResult.impact,
      };
    }

    return {
      decision: "REJECT",
      score: null,
      positiveFactors: [],
      negativeFactors: [],
      restrictions: [
        { code: "AGENT_BUSY", message: "El repartidor sigue ocupado con otro pedido" },
        ...batchResult.restrictions,
      ],
      estimatedImpact: {},
    };
  }

  const restrictions = checkHardConstraints({ order, preferences });
  const shiftConstraint = checkShiftTimeConstraint({ order, simulation });
  if (shiftConstraint) restrictions.push(shiftConstraint);

  const { score, positiveFactors, negativeFactors } = computeScore({ order, preferences, simulation });

  let decision;
  if (restrictions.length > 0) {
    decision = "REJECT";
  } else if (score >= ACCEPT_THRESHOLD) {
    decision = "ACCEPT";
  } else if (score >= WAIT_THRESHOLD) {
    decision = "WAIT";
  } else {
    decision = "REJECT";
  }

  return { decision, score, positiveFactors, negativeFactors, restrictions, estimatedImpact: {} };
}

module.exports = {
  evaluateSmartCourier,
  WEIGHTS,
  ACCEPT_THRESHOLD,
  WAIT_THRESHOLD,
};
