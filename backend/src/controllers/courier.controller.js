const { getCourierService } = require("../courier/courierService");

// Los errores de entrada devuelven 400 con mensaje; el fast path nunca queda
// esperando al modelo, así que aquí no hay awaits en /decide.
function badRequest(res, error) {
  res.status(400).json({ error: error.message });
}

function decide(req, res) {
  try {
    res.json(getCourierService().decide(req.body));
  } catch (error) {
    badRequest(res, error);
  }
}

function explain(req, res) {
  const record = getCourierService().explain(req.params.orderId);
  if (!record) return res.status(404).json({ error: `No hay decisión registrada para ${req.params.orderId}` });
  res.json(record);
}

function status(req, res) {
  res.json(getCourierService().status());
}

function shock(req, res) {
  try {
    res.status(201).json(getCourierService().injectShock(req.body));
  } catch (error) {
    badRequest(res, error);
  }
}

function startShift(req, res) {
  try {
    res.status(201).json(getCourierService().startShift(req.body));
  } catch (error) {
    badRequest(res, error);
  }
}

async function refreshStrategy(req, res) {
  res.json(await getCourierService().refreshStrategy());
}

// Para ensayar la falla del modelo en la demo: cambia la credencial del
// proceso sin reiniciar (una credencial inválida → degraded en /status).
async function setModelCredential(req, res) {
  process.env.COURIER_MODEL_API_KEY = req.body.key ?? "";
  res.json(await getCourierService().refreshStrategy());
}

function replay(req, res) {
  try {
    res.json(getCourierService().replay(typeof req.body === "string" ? req.body : ""));
  } catch (error) {
    badRequest(res, error);
  }
}

module.exports = { decide, explain, status, shock, startShift, refreshStrategy, setModelCredential, replay };
