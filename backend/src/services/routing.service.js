const axios = require("axios");
const { haversineDistanceKm } = require("../utils/geo");
const logger = require("../utils/logger");

const OSRM_TIMEOUT_MS = 5000;

// Factor que aproxima el recorrido real de calles sobre la distancia en
// línea recta (sección 15: "distancia haversine + factor estimado de calles").
const STREET_FACTOR = 1.3;

// Velocidad promedio urbana usada para estimar el tiempo cuando no hay
// datos reales de tráfico ni ruta calculada por OSRM.
const AVERAGE_SPEED_KMH = 25;

function straightLineGeometry(originLat, originLng, destinationLat, destinationLng) {
  return {
    type: "LineString",
    coordinates: [
      [originLng, originLat],
      [destinationLng, destinationLat],
    ],
  };
}

function estimatedFallback(originLat, originLng, destinationLat, destinationLng) {
  const straightLineKm = haversineDistanceKm(originLat, originLng, destinationLat, destinationLng);
  const distanceKm = straightLineKm * STREET_FACTOR;
  const durationMinutes = (distanceKm / AVERAGE_SPEED_KMH) * 60;

  return {
    distanceKm: Number(distanceKm.toFixed(3)),
    durationMinutes: Number(durationMinutes.toFixed(2)),
    geometry: straightLineGeometry(originLat, originLng, destinationLat, destinationLng),
    source: "ESTIMATED",
  };
}

async function getRoute({ originLat, originLng, destinationLat, destinationLng }) {
  const baseUrl = process.env.OSRM_BASE_URL;
  const coordinates = `${originLng},${originLat};${destinationLng},${destinationLat}`;
  const url = `${baseUrl}/route/v1/driving/${coordinates}`;

  try {
    const response = await axios.get(url, {
      params: { overview: "full", geometries: "geojson" },
      timeout: OSRM_TIMEOUT_MS,
    });

    const route = response.data?.routes?.[0];

    if (!route) {
      throw new Error("OSRM no devolvió rutas");
    }

    return {
      distanceKm: Number((route.distance / 1000).toFixed(3)),
      durationMinutes: Number((route.duration / 60).toFixed(2)),
      geometry: route.geometry,
      source: "ROUTED",
    };
  } catch (error) {
    logger.error(`OSRM falló (${error.message}), usando fallback estimado`);
    return estimatedFallback(originLat, originLng, destinationLat, destinationLng);
  }
}

module.exports = {
  getRoute,
  AVERAGE_SPEED_KMH,
  STREET_FACTOR,
};
