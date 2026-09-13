const routingService = require("../services/routing.service");
const HttpError = require("../utils/httpError");

// Acepta también strings numéricos: Postgres devuelve columnas NUMERIC como
// texto y el cliente suele reenviarlas tal cual.
function isValidCoordinate(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

async function getRoute(req, res) {
  const { originLat, originLng, destinationLat, destinationLng } = req.body;

  if (
    !isValidCoordinate(originLat) ||
    !isValidCoordinate(originLng) ||
    !isValidCoordinate(destinationLat) ||
    !isValidCoordinate(destinationLng)
  ) {
    throw new HttpError(
      400,
      "Se requieren originLat, originLng, destinationLat y destinationLng numéricos"
    );
  }

  const route = await routingService.getRoute({
    originLat,
    originLng,
    destinationLat,
    destinationLng,
  });

  res.json(route);
}

module.exports = {
  getRoute,
};
