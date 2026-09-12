// Zonas heurísticas de Monterrey para reposicionamiento (sección 22) y
// demanda espacial (sección 21). No hay datos demográficos/de tráfico
// reales disponibles, así que cada zona tiene un "atractivo base" fijo,
// documentado y editable — no es Machine Learning (sección 0), es una
// regla determinista que combina lugar + hora del día.
const { haversineDistanceKm } = require("../utils/geo");

const ZONES = [
  { name: "Centro", lat: 25.6693, lng: -100.3096, baseAttractiveness: 0.3 },
  { name: "San Pedro", lat: 25.6514, lng: -100.4022, baseAttractiveness: 0.2 },
  { name: "San Nicolás", lat: 25.7417, lng: -100.3021, baseAttractiveness: 0.1 },
  { name: "Guadalupe", lat: 25.6767, lng: -100.256, baseAttractiveness: 0.0 },
  { name: "Cumbres", lat: 25.737, lng: -100.356, baseAttractiveness: -0.1 },
  { name: "Apodaca", lat: 25.7815, lng: -100.1888, baseAttractiveness: -0.2 },
];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// Nivel base de demanda por hora del día, reutilizando el mismo concepto
// de horas pico que OrderGenerator (sección 21), pero determinista (sin
// RNG) porque una consulta de "¿qué tan buena es mi zona ahora?" debe dar
// siempre la misma respuesta en un instante dado.
function hourDemandBaseline(hour) {
  const isDinnerRush = hour >= 18 && hour < 21;
  const isLunchRush = hour >= 12 && hour < 14;

  if (isDinnerRush) return 0.8;
  if (isLunchRush) return 0.6;
  return 0.3;
}

function zoneDemandLevel(zone, simulatedHour) {
  const score = clamp01(hourDemandBaseline(simulatedHour) + zone.baseAttractiveness);

  if (score >= 0.75) return "VERY_HIGH";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.25) return "MEDIUM";
  return "LOW";
}

function nearestZone(lat, lng) {
  return ZONES.reduce((best, zone) => {
    const distanceKm = haversineDistanceKm(lat, lng, zone.lat, zone.lng);
    return !best || distanceKm < best.distanceKm ? { ...zone, distanceKm } : best;
  }, null);
}

module.exports = {
  ZONES,
  zoneDemandLevel,
  nearestZone,
};
