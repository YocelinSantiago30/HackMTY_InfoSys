const optimizationService = require("../services/optimization.service");
const HttpError = require("../utils/httpError");

async function optimizeBatch(req, res) {
  const { start, stops } = req.body;

  if (!start || !Array.isArray(stops) || stops.length === 0) {
    throw new HttpError(400, "Se requieren start y stops (al menos una parada)");
  }

  const result = await optimizationService.optimizeBatch({ start, stops });

  if (!result.success) {
    throw new HttpError(503, "El servicio de optimización no está disponible");
  }

  res.json({ order: result.order, totalDistanceKm: result.totalDistanceKm });
}

module.exports = {
  optimizeBatch,
};
