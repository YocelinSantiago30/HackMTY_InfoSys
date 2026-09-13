// Endpoints del agente en vivo con el servicio Python real del tier 2:
// contrato de /decide (validador oficial), /explain, shocks, replay y
// fallo del modelo (credencial inválida → degradado → recuperación).
const os = require("os");
const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const execFileAsync = promisify(require("child_process").execFile);
const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { startModelService } = require("../scripts/courier/modelService");

const MODEL_KEY = "endpoint-test-key";
let service;
let server;
let base;

test.before(async () => {
  service = await startModelService({ port: 8013, apiKey: MODEL_KEY });
  process.env.COURIER_MODEL_URL = service.url;
  process.env.COURIER_MODEL_API_KEY = MODEL_KEY;
  process.env.COURIER_DECISION_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "courier-")), "decisions.jsonl");

  const app = require("../src/app");
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server?.close();
  await service?.stop();
  require("../src/config/database").end();
});

const post = (url, body, config) => axios.post(`${base}${url}`, body, config).then((r) => r.data);
const get = (url) => axios.get(`${base}${url}`).then((r) => r.data);

test("turno en vivo: /decide cumple el contrato y /explain responde desde el log", async () => {
  await post("/shift/start", { seed: 1234, shift_hours: 8, vehicle: "moto", start_location_zone: 7, shift_start_time: "2026-03-21T15:00:00" });
  const strategy = await post("/strategy/refresh", {});
  assert.equal(strategy.degraded, false);
  assert.ok(strategy.reservation_wage_mxn_hr >= 0);

  const decision = await post("/decide", {
    order_id: "LIVE-001",
    sim_time: "2026-03-21T18:42:00",
    zone_pickup: 7,
    zone_dropoff: 11,
    distance_pickup_km: 1.4,
    distance_delivery_km: 6.5,
    base_pay_mxn: 58,
    surge_multiplier: 1.3,
    weight_kg: 2.1,
    volume_liters: 6,
    vehicle: "moto",
  });
  for (const key of ["order_id", "decision", "reason", "latency_ms", "binding_constraint", "tier", "degraded", "economics"]) assert.ok(key in decision, key);
  assert.ok(decision.latency_ms < 50);

  const explanation = await get("/explain/LIVE-001");
  for (const key of ["order_id", "decision", "reason", "inputs", "alternatives_considered"]) assert.ok(key in explanation, key);
  assert.equal(explanation.inputs.courier_state.shift_end_time, "2026-03-21T23:00:00");
});

test("validador oficial contra el endpoint en vivo", async () => {
  // Asíncrono: el servidor corre en este mismo proceso y debe poder responder.
  const validator = path.join(__dirname, "../../courier/validate_format.py");
  const { stdout } = await execFileAsync("python3", [validator, "--endpoint", `${base}/decide`]);
  assert.match(stdout, /PASS/);
});

test("shock en vivo: lluvia cambia la predicción sin bloquear decisiones", async () => {
  const request = {
    order_id: "LIVE-RAIN",
    sim_time: "2026-03-21T19:10:00",
    zone_pickup: 1,
    zone_dropoff: 12,
    distance_pickup_km: 2,
    distance_delivery_km: 5,
    base_pay_mxn: 70,
    surge_multiplier: 1,
    weight_kg: 1,
    volume_liters: 3,
    vehicle: "moto",
  };
  const dry = await post("/decide", request);
  await post("/shock", { sim_time: "2026-03-21T19:00:00", shock_type: "rain", duration_min: 45 });
  const wet = await post("/decide", { ...request, order_id: "LIVE-RAIN-2" });

  assert.ok(wet.economics.total_time_min > dry.economics.total_time_min);
  const status = await get("/status");
  assert.ok(status.active_shocks.some((s) => s.shock_type === "rain"));
});

test("fallo del modelo: credencial inválida → degradado sin detener decisiones → recuperación", async () => {
  const degraded = await post("/admin/model-credential", { key: "credencial-invalida" });
  assert.equal(degraded.degraded, true);
  assert.equal((await get("/status")).degraded, true);

  const started = Date.now();
  const decision = await post("/decide", {
    order_id: "LIVE-DEGRADED",
    sim_time: "2026-03-21T19:20:00",
    zone_pickup: 5,
    zone_dropoff: 5,
    distance_pickup_km: 0.6,
    distance_delivery_km: 1.8,
    base_pay_mxn: 41,
    surge_multiplier: 1,
    weight_kg: 1,
    volume_liters: 3.5,
    vehicle: "moto",
  });
  assert.equal(decision.degraded, true);
  assert.ok(Date.now() - started < 1000, "no espera al modelo");
  assert.ok(decision.latency_ms < 50);

  const recovered = await post("/admin/model-credential", { key: MODEL_KEY });
  assert.equal(recovered.degraded, false);
  assert.equal((await get("/status")).degraded, false);
});

test("/replay re-decide un turno grabado sin diferencias", async () => {
  const { runShift, ourAgent, toJsonl } = require("../src/courier/simulator");
  const { loadDemandModel } = require("../src/courier/demandModel");
  const strategy = { reservation_wage_mxn_hr: 80, degraded: false };
  const shift = await runShift(
    { seed: 4242, shift_hours: 6, vehicle: "car", start_location_zone: 3 },
    ourAgent({ demandModel: loadDemandModel(), strategyClient: { current: () => strategy, refresh: async () => strategy } })
  );
  const result = await post("/replay", toJsonl(shift.events), { headers: { "Content-Type": "text/plain" } });
  assert.equal(result.identical, true);
  assert.ok(result.compared > 0);

  // "¿Por qué saltaste ese pedido?" se contesta desde el log, sin re-simular.
  const skipped = shift.events.find((e) => e.event === "decision" && e.decision === "SKIP");
  const why = await get(`/explain/${skipped.order_id}`);
  assert.equal(why.decision, "SKIP");
  assert.equal(why.reason, skipped.reason);
  assert.ok(why.alternatives_considered.length > 0);
});
