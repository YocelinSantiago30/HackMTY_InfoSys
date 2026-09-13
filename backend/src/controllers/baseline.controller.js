function evaluarBaseline(req, res) {
  const { pago, distancia, tiempo } = req.body;

  const rentabilidad = pago / tiempo;

  let decision;

  if (rentabilidad >= 3) {
    decision = "ACEPTAR";
  } else {
    decision = "RECHAZAR";
  }

  res.json({
    pago,
    distancia,
    tiempo,
    rentabilidad: Number(rentabilidad.toFixed(2)),
    decision,
  });
}

module.exports = {
  evaluarBaseline,
};
  