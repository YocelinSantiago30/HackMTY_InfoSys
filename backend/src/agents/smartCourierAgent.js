// Agente principal. A diferencia de Baseline (umbral sobre el pago que
// muestra la app: pago/min y pago/km de la entrega), SmartCourier evalúa lo
// que el pedido REALMENTE le deja: incluye el trayecto vacío hasta el
// pickup, la espera de preparación y el costo operativo del vehículo.
//
// Ambos agentes viven la misma física (SimulationCore): mismos pedidos,
// mismas rutas, mismos costos. La ventaja de SmartCourier sale de:
// 1) no aceptar pedidos que se ven bien pero ocupan mucho tiempo/km vacío,
//    dejándolo libre para pedidos mejores que llegarán después;
// 2) agrupar pedidos compatibles cuando va ocupado (batchEvaluator.js).
// (El reposicionamiento a zonas de demanda existe pero está desactivado por
// defecto: medido con compareStrategies.js, su costo en km no se recupera.)
//
// Función pura: no toca la base de datos (sección 58: testable).

const { haversineDistanceKm } = require("../utils/geo");
const { simulatedHourOfDay } = require("../simulation/simulatedTime");

// Pesos en puntos (suman 100). La ganancia por minuto domina porque el
// recurso escaso de un repartidor es su tiempo de turno.
const WEIGHTS = {
  profitPerMinute: 35,
  netProfit: 15,
  profitPerKm: 15,
  distanceToPickup: 10,
  totalTime: 10,
  destinationDemand: 15,
};

// Referencias de normalización (MXN, minutos, km).
const REFERENCE = {
  minProfitPerMinute: 0.5,
  maxProfitPerMinute: 4.0,
  maxNetProfit: 120,
  minProfitPerKm: 2,
  maxProfitPerKm: 12,
  maxPickupKm: 8,
  minTotalMinutes: 15,
  maxTotalMinutes: 60,
};

// Calibrados con backend/scripts/compareStrategies.js sobre seeds de
// entrenamiento y validados en seeds distintas (ver ese script).
// - accept: umbral de la política por puntaje (se usa dentro de las
//   simulaciones de escenarios, donde no hay lookahead anidado).
// - wait: por debajo de este puntaje el pedido se rechaza sin simular.
const DEFAULT_THRESHOLDS = {
  accept: 40,
  wait: 25,
};

const DEMAND_FRACTIONS = { LOW: 0, MEDIUM: 0.4, HIGH: 0.7, VERY_HIGH: 1.0 };
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

function normalize(value, min, max) {
  return clamp01((value - min) / (max - min));
}

function checkHardConstraints({ order, metrics, preferences }) {
  const restrictions = [];

  const bagMaxWeight = toNumber(preferences.bag_max_weight, null);
  if (bagMaxWeight !== null && Number(order.package_weight) > bagMaxWeight) {
    restrictions.push({
      code: "BAG_CAPACITY_EXCEEDED",
      message: `El paquete (${order.package_weight}kg) excede la capacidad de la mochila configurada (${bagMaxWeight}kg)`,
    });
  }

  const nightLimit = toNumber(preferences.night_distance_limit_km, null);
  if (nightLimit !== null) {
    const hour = simulatedHourOfDay(order.created_at_simulation_second);
    const isNight = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
    if (isNight && Number(order.distance_km) > nightLimit) {
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
      Number(order.pickup_lat),
      Number(order.pickup_lng)
    );
    if (distanceFromCenter > workZoneRadius) {
      restrictions.push({
        code: "OUTSIDE_WORK_ZONE",
        message: `El punto de recolección está a ${distanceFromCenter.toFixed(1)}km del centro de tu zona de trabajo (radio configurado: ${workZoneRadius}km)`,
      });
    }
  }

  if (metrics.netProfit <= 0) {
    restrictions.push({
      code: "NEGATIVE_PROFIT",
      message: `Ganancia neta estimada $${metrics.netProfit.toFixed(2)}: el costo operativo ($${metrics.operatingCost.toFixed(2)}) supera el pago`,
    });
  }

  return restrictions;
}

function computeScore({ order, metrics }) {
  const factors = [
    {
      factor: "PROFIT_PER_MINUTE",
      weight: WEIGHTS.profitPerMinute,
      fraction: normalize(metrics.profitPerMinute, REFERENCE.minProfitPerMinute, REFERENCE.maxProfitPerMinute),
    },
    { factor: "NET_PROFIT", weight: WEIGHTS.netProfit, fraction: normalize(metrics.netProfit, 0, REFERENCE.maxNetProfit) },
    {
      factor: "PROFIT_PER_KM",
      weight: WEIGHTS.profitPerKm,
      fraction: normalize(metrics.profitPerKm, REFERENCE.minProfitPerKm, REFERENCE.maxProfitPerKm),
    },
    {
      factor: "DISTANCE_TO_PICKUP",
      weight: WEIGHTS.distanceToPickup,
      fraction: 1 - clamp01(metrics.distanceToPickupKm / REFERENCE.maxPickupKm),
    },
    {
      factor: "TOTAL_TIME",
      weight: WEIGHTS.totalTime,
      fraction: 1 - normalize(metrics.totalMinutes, REFERENCE.minTotalMinutes, REFERENCE.maxTotalMinutes),
    },
    {
      // Demanda estimada en el destino a la HORA DE LLEGADA (no a la hora del pedido).
      factor: "DESTINATION_DEMAND",
      weight: WEIGHTS.destinationDemand,
      fraction: DEMAND_FRACTIONS[metrics.destinationDemandAtArrival ?? order.destination_demand] ?? 0.4,
    },
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.fraction * f.weight, 0));

  // Un factor con menos del 40% de su peso se reporta como negativo para que
  // el Decision Inspector explique qué hizo flojo al pedido.
  const toEntry = (f) => ({ factor: f.factor, points: round2(f.fraction * f.weight) });
  return {
    score,
    positiveFactors: factors.filter((f) => f.fraction >= 0.4).map(toEntry),
    negativeFactors: factors.filter((f) => f.fraction < 0.4).map(toEntry),
  };
}

// metrics: ver economics.offerEconomics (trayecto al pickup + espera + entrega).
// lookahead (opcional): resultado de lookaheadPlanner.compareAcceptVsWait,
// simulaciones desde el mismo estado. Si existe, reemplaza la banda fija de WAIT.
function evaluateSmartCourier({ order, metrics, preferences = {}, thresholds = DEFAULT_THRESHOLDS, lookahead = null }) {
  const restrictions = checkHardConstraints({ order, metrics, preferences });
  const { score, positiveFactors, negativeFactors } = computeScore({ order, metrics });
  const estimatedImpact = lookahead ? { ...metrics, lookahead } : metrics;

  let decision;
  if (restrictions.length > 0 || score < thresholds.wait) {
    decision = "REJECT";
  } else if (lookahead) {
    // Aceptar solo si, en promedio sobre los mismos escenarios, deja más
    // ganancia neta que seguir libre esperando otro pedido.
    decision = lookahead.acceptAdvantage >= 0 ? "ACCEPT" : "WAIT";
  } else {
    decision = score >= thresholds.accept ? "ACCEPT" : "WAIT";
  }

  return { decision, score, positiveFactors, negativeFactors, restrictions, estimatedImpact };
}

module.exports = {
  evaluateSmartCourier,
  WEIGHTS,
  DEFAULT_THRESHOLDS,
};
