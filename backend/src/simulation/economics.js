// Parámetros físicos y económicos compartidos por AMBOS agentes. Cualquier
// diferencia de resultados entre Baseline y SmartCourier debe venir de sus
// decisiones, nunca de reglas distintas aquí.

// El servidor público de OSRM solo ofrece el perfil de automóvil, así que la
// GEOMETRÍA y la distancia siempre vienen de "driving"; el TIEMPO se ajusta
// por vehículo:
// - bike: velocidad propia (no usa los tiempos de auto) y casi no le afecta
//   el tráfico vehicular;
// - motorcycle: algo más rápida que un auto en ciudad y menos sensible a
//   congestión (filtra entre carriles);
// - car: tiempos de OSRM tal cual y sensibilidad completa al tráfico.
// costPerKm (MXN): combustible/energía + mantenimiento + depreciación.
const VEHICLE_PROFILES = {
  bike: { costPerKm: 0.4, speedKmh: 16, durationFactor: null, trafficSensitivity: 0.15 },
  motorcycle: { costPerKm: 2.0, speedKmh: null, durationFactor: 0.85, trafficSensitivity: 0.6 },
  car: { costPerKm: 4.5, speedKmh: null, durationFactor: 1.0, trafficSensitivity: 1.0 },
};
const DEFAULT_VEHICLE = "motorcycle";

// Multiplicador de tiempo para un auto (sensibilidad 1.0).
const TRAFFIC_TIME_FACTORS = {
  LOW: 1.0,
  MEDIUM: 1.15,
  HIGH: 1.35,
  SEVERE: 1.6,
};

// Sección 25: sin grafo de calles editable, un cierre vial se modela como
// desvío uniforme sobre los tramos que aún no se recorren.
const ROAD_CLOSURE_DETOUR_FACTOR = 1.6;

function vehicleProfile(preferences = {}) {
  return VEHICLE_PROFILES[preferences.vehicle_type] ?? VEHICLE_PROFILES[DEFAULT_VEHICLE];
}

function operatingCostPerKm(preferences = {}) {
  return vehicleProfile(preferences).costPerKm;
}

function trafficFactor(level) {
  return TRAFFIC_TIME_FACTORS[level] ?? 1;
}

function vehicleTrafficFactor(level, profile) {
  return 1 + (trafficFactor(level) - 1) * profile.trafficSensitivity;
}

// Tramo "base": distancia de calle y tiempo del vehículo SIN tráfico ni
// desvíos. Se guarda así para poder re-temporizarlo cuando cambian las condiciones.
function baseLegFromRoute(route, profile) {
  const baseDistanceKm = Number(route.distanceKm);
  const baseDurationMinutes = profile.speedKmh
    ? (baseDistanceKm / profile.speedKmh) * 60
    : Number(route.durationMinutes) * profile.durationFactor;

  return { baseDistanceKm, baseDurationMinutes, coordinates: route.geometry?.coordinates };
}

// Tramo efectivo bajo unas condiciones { level, detourFactor, version }.
function effectiveLeg(baseLeg, conditions, profile) {
  return {
    ...baseLeg,
    distanceKm: baseLeg.baseDistanceKm * conditions.detourFactor,
    durationMinutes:
      baseLeg.baseDurationMinutes * conditions.detourFactor * vehicleTrafficFactor(conditions.level, profile),
    trafficVersion: conditions.version,
  };
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

// Economía real de tomar UN pedido estando libre: trayecto vacío al pickup
// (tramo 0), espera de preparación y entrega (tramo 1). Es la misma cuenta
// para ambos agentes; solo SmartCourier la usa para decidir.
function offerEconomics({ timeline, payment, costPerKm }) {
  const [toPickup, delivery] = timeline.legs;
  const pickupStop = timeline.stops[0];
  const totalKm = timeline.totalKm;
  const totalMinutes = Math.max((timeline.endSecond - timeline.startSecond) / 60, 1 / 60);
  const operatingCost = totalKm * costPerKm;
  const netProfit = Number(payment) - operatingCost;

  return {
    distanceToPickupKm: round2(toPickup.distanceKm),
    toPickupMinutes: round2((toPickup.toSecond - toPickup.fromSecond) / 60),
    waitMinutes: round2((pickupStop.departSecond - pickupStop.arriveSecond) / 60),
    deliveryDistanceKm: round2(delivery.distanceKm),
    deliveryMinutes: round2((delivery.toSecond - delivery.fromSecond) / 60),
    totalKm: round2(totalKm),
    totalMinutes: round2(totalMinutes),
    grossPayment: round2(payment),
    operatingCost: round2(operatingCost),
    netProfit: round2(netProfit),
    profitPerMinute: round2(netProfit / totalMinutes),
    profitPerKm: round2(totalKm > 0 ? netProfit / totalKm : netProfit),
    promisedDropoffSecond: timeline.stops[1].arriveSecond,
  };
}

module.exports = {
  VEHICLE_PROFILES,
  TRAFFIC_TIME_FACTORS,
  ROAD_CLOSURE_DETOUR_FACTOR,
  vehicleProfile,
  operatingCostPerKm,
  trafficFactor,
  vehicleTrafficFactor,
  baseLegFromRoute,
  effectiveLeg,
  offerEconomics,
  round2,
};
