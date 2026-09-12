const logger = require("../utils/logger");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.originalUrl} -> ${err.message}`);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    status: "ERROR",
    message: err.message || "Error interno del servidor",
  });
}

module.exports = errorHandler;
