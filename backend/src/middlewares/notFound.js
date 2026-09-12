function notFound(req, res) {
  res.status(404).json({
    status: "ERROR",
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = notFound;
