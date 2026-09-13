const axios = require("axios");
const { haversineDistanceKm } = require("../utils/geo");
const logger = require("../utils/logger");

const OSRM_TIMEOUT_MS = 5000;

// Calibrados contra OSRM en el área de servicio de Monterrey (muestra de 29
// rutas): km por calle / km en línea recta ≈ 1.38; velocidad de flujo libre
// ≈ 47 km/h. El tráfico se aplica aparte (economics.TRAFFIC_TIME_FACTORS),
// igual que sobre las rutas de OSRM, para que el fallback se comporte igual.
const STREET_FACTOR = 1.38;
const AVERAGE_SPEED_KMH = 45;

// Ambos agentes piden los mismos tramos (misma ubicación inicial, mismos
// pickups), así que cachear evita llamadas repetidas a OSRM y garantiza que
// los dos reciban exactamente la misma distancia/tiempo para el mismo tramo.
const CACHE_MAX_ENTRIES = 2000;
const routeCache = new Map();

function cacheKey(originLat, originLng, destinationLat, destinationLng) {
  return [originLat, originLng, destinationLat, destinationLng].map((v) => v.toFixed(5)).join(",");
}

function estimateRoute({ originLat, originLng, destinationLat, destinationLng }) {
  const distanceKm = haversineDistanceKm(originLat, originLng, destinationLat, destinationLng) * STREET_FACTOR;

  return {
    distanceKm: Number(distanceKm.toFixed(3)),
    durationMinutes: Number(((distanceKm / AVERAGE_SPEED_KMH) * 60).toFixed(2)),
    // GeoJSON: [longitud, latitud]
    geometry: {
      type: "LineString",
      coordinates: [
        [originLng, originLat],
        [destinationLng, destinationLat],
      ],
    },
    source: "ESTIMATED",
  };
}

async function fetchOsrmRoute({ originLat, originLng, destinationLat, destinationLng }) {
  // OSRM recibe "longitud,latitud" (no lat,lng).
  const coordinates = `${originLng},${originLat};${destinationLng},${destinationLat}`;
  const url = `${process.env.OSRM_BASE_URL}/route/v1/driving/${coordinates}`;

  const response = await axios.get(url, {
    params: { overview: "full", geometries: "geojson" },
    timeout: OSRM_TIMEOUT_MS,
  });

  const route = response.data?.routes?.[0];
  if (!route) throw new Error("OSRM no devolvió rutas");

  return {
    distanceKm: Number((route.distance / 1000).toFixed(3)),
    durationMinutes: Number((route.duration / 60).toFixed(2)),
    geometry: route.geometry,
    source: "ROUTED",
  };
}

async function getRoute(params) {
  const originLat = Number(params.originLat);
  const originLng = Number(params.originLng);
  const destinationLat = Number(params.destinationLat);
  const destinationLng = Number(params.destinationLng);
  const coords = { originLat, originLng, destinationLat, destinationLng };

  if (haversineDistanceKm(originLat, originLng, destinationLat, destinationLng) < 0.005) {
    return { ...estimateRoute(coords), distanceKm: 0, durationMinutes: 0, source: "ROUTED" };
  }

  const key = cacheKey(originLat, originLng, destinationLat, destinationLng);
  if (routeCache.has(key)) return routeCache.get(key);

  let route;
  if (process.env.OSRM_BASE_URL) {
    try {
      route = await fetchOsrmRoute(coords);
    } catch (error) {
      logger.error(`OSRM falló (${error.message}), usando fallback estimado`);
      route = estimateRoute(coords);
    }
  } else {
    route = estimateRoute(coords);
  }

  if (routeCache.size >= CACHE_MAX_ENTRIES) {
    routeCache.delete(routeCache.keys().next().value);
  }
  routeCache.set(key, route);
  return route;
}

module.exports = {
  getRoute,
  estimateRoute,
  AVERAGE_SPEED_KMH,
  STREET_FACTOR,
};
