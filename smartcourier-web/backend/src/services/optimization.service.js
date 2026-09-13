const axios = require("axios");
const logger = require("../utils/logger");

const TIMEOUT_MS = 3000;

// Si optimization-service no responde, el llamador debe caer a su propia
// heurística de respaldo (igual que routing.service.js hace con OSRM,
// sección 15) — nunca debe detener la simulación.
async function optimizeBatch({ start, stops }) {
  const url = `${process.env.OPTIMIZATION_SERVICE_URL}/optimize-batch`;

  try {
    const response = await axios.post(url, { start, stops }, { timeout: TIMEOUT_MS });
    return {
      success: true,
      order: response.data.order,
      totalDistanceKm: response.data.total_distance_km,
    };
  } catch (error) {
    logger.error(`optimization-service no disponible (${error.message}), usando respaldo heurístico`);
    return { success: false };
  }
}

module.exports = {
  optimizeBatch,
};
