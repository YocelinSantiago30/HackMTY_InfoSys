// Cuando SmartCourier está libre (sin pedido activo), evalúa WAIT vs
// REPOSITION (sección 22). Solo se invoca para SmartCourier — Baseline no
// hace análisis de demanda ni reposicionamiento (sección 3).
//
// Función pura: no toca la base de datos (sección 58: testable).

const { haversineDistanceKm } = require("../utils/geo");
const { ZONES, zoneDemandLevel, nearestZone } = require("../simulation/zones");
const { AVERAGE_SPEED_KMH } = require("../services/routing.service");

const DEMAND_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 };
// Sección 22: "no reposicionarse innecesariamente". 10km porque las 6 zonas
// heurísticas de Monterrey están espaciadas 5-26km entre sí (ciudad real) —
// un umbral más bajo (ej. 5km) nunca alcanzaría a ninguna zona vecina y
// REPOSITION jamás se dispararía en la práctica.
const MAX_REPOSITION_DISTANCE_KM = 10;

function toNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function evaluateReposition({ currentLat, currentLng, simulatedHour, preferences = {} }) {
  const currentZone = nearestZone(currentLat, currentLng);
  const currentDemand = zoneDemandLevel(currentZone, simulatedHour);

  if (DEMAND_RANK[currentDemand] >= DEMAND_RANK.HIGH) {
    return {
      decision: "WAIT",
      reasons: [
        {
          code: "ALREADY_IN_HIGH_DEMAND_ZONE",
          message: `Ya está en ${currentZone.name}, demanda ${currentDemand}`,
        },
      ],
      impact: { currentZone: currentZone.name, currentDemand },
    };
  }

  const workZoneRadius = toNumber(preferences.work_zone_radius_km, null);
  const workZoneLat = toNumber(preferences.work_zone_center_lat, null);
  const workZoneLng = toNumber(preferences.work_zone_center_lng, null);
  const hasWorkZone = workZoneRadius !== null && workZoneLat !== null && workZoneLng !== null;

  const candidates = ZONES.filter((zone) => zone.name !== currentZone.name)
    .map((zone) => ({
      zone,
      demand: zoneDemandLevel(zone, simulatedHour),
      distanceKm: haversineDistanceKm(currentLat, currentLng, zone.lat, zone.lng),
    }))
    .filter((candidate) => candidate.distanceKm <= MAX_REPOSITION_DISTANCE_KM)
    .filter((candidate) => DEMAND_RANK[candidate.demand] > DEMAND_RANK[currentDemand])
    .filter((candidate) => {
      if (!hasWorkZone) return true;
      const distanceFromWorkCenter = haversineDistanceKm(
        workZoneLat,
        workZoneLng,
        candidate.zone.lat,
        candidate.zone.lng
      );
      return distanceFromWorkCenter <= workZoneRadius;
    });

  if (candidates.length === 0) {
    return {
      decision: "WAIT",
      reasons: [
        {
          code: "NO_BETTER_ZONE_NEARBY",
          message: `Ninguna zona cercana (≤${MAX_REPOSITION_DISTANCE_KM}km) supera la demanda actual (${currentDemand}) en ${currentZone.name}`,
        },
      ],
      impact: { currentZone: currentZone.name, currentDemand },
    };
  }

  candidates.sort(
    (a, b) => DEMAND_RANK[b.demand] - DEMAND_RANK[a.demand] || a.distanceKm - b.distanceKm
  );
  const best = candidates[0];
  const travelTimeMinutes = Number(((best.distanceKm / AVERAGE_SPEED_KMH) * 60).toFixed(2));

  return {
    decision: "REPOSITION",
    reasons: [
      {
        code: "BETTER_ZONE_FOUND",
        message: `${currentZone.name} (${currentDemand}) -> ${best.zone.name} (${best.demand}), ${best.distanceKm.toFixed(1)}km, ${travelTimeMinutes.toFixed(1)}min`,
      },
    ],
    impact: {
      fromZone: currentZone.name,
      toZone: best.zone.name,
      fromDemand: currentDemand,
      toDemand: best.demand,
      distanceKm: Number(best.distanceKm.toFixed(3)),
      travelTimeMinutes,
      toLat: best.zone.lat,
      toLng: best.zone.lng,
    },
  };
}

module.exports = {
  evaluateReposition,
  MAX_REPOSITION_DISTANCE_KM,
};
