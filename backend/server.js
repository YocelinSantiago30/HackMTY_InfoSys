const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    mensaje: "SmartCourier Backend funcionando"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK"
  });
});


app.post("/api/evaluar-baseline", (req, res) => {

  const {
    pago,
    distancia,
    tiempo
  } = req.body;

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
    decision
  });

});


const PORT = 5000;

app.listen(PORT, () => {
  console.log(
    `Servidor corriendo en http://localhost:${PORT}`
  );
});