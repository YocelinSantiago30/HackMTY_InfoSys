// Courier: una prueba por categoría de courier/evaluation_protocol.md §3-§6.
// No hay respuestas esperadas oficiales; aquí se verifica que cada regla
// SE DISPARE en su frontera, nombre la restricción correcta y no cambie al
// subir el pago.
const test = require("node:test");
const assert = require("node:assert/strict");
const { decide } = require("../src/courier/fastPath");
const { loadDemandModel } = require("../src/courier/demandModel");
const { generateShift, streamSha256 } = require("../src/courier/orderStream");
const { runShift, ourAgent } = require("../src/courier/simulator");
const { replayEvents } = require("../src/courier/replay");
const { acceptAll, planPolicy } = require("../src/courier/baselines");
const { solveOracle } = require("../src/courier/oracle");
const { TUNING_CONFIGS, REPORTING_SEEDS, TUNING_SEEDS } = require("../src/courier/seedSets");
const { VEHICLES, FLAGGED_ZONES, MAX_IN_FLIGHT_ORDERS } = require("../src/courier/config");
const StrategyClient = require("../src/courier/strategyClient");

const demandModel = loadDemandModel();
const CONSTRAINTS = new Set(["flagged_zone_night", "mandatory_break", "heat_rule", "shift_end_infeasible", "vehicle_capacity", "reservation_wage", null]);

function order(overrides = {}) {
  const { courier_state_overrides: state, ...rest } = overrides;
  return {
    order_id: "ORD-T1",
    platform: "rappi",
    sim_time: "2026-03-21T18:00:00",
    zone_pickup: 1,
    zone_dropoff: 12,
    distance_pickup_km: 1.0,
    distance_delivery_km: 3.0,
    base_pay_mxn: 60,
    est_tip_mxn: 10,
    surge_multiplier: 1.0,
    restaurant_prep_min: 5,
    weight_kg: 2,
    volume_liters: 6,
    vehicle: "moto",
    ...rest,
    courier_state_overrides: {
      continuous_riding_min: 0,
      shift_elapsed_hours: 2,
      last_break_end_time: null,
      shift_end_time: "2026-03-21T23:00:00",
      in_flight_orders: [],
      ...state,
    },
  };
}

function run(request, reservationWage = 0) {
  return decide(request, { demandModel, strategy: { reservation_wage_mxn_hr: reservationWage, degraded: false } }).response;
}

// Una negativa de seguridad debe sobrevivir a un pago absurdo.
function assertSafetyInvariant(request, constraint) {
  const base = run(request);
  const rich = run({ ...request, base_pay_mxn: 5000, surge_multiplier: 3, est_tip_mxn: 500 });
  for (const response of [base, rich]) {
    assert.equal(response.decision, "SKIP");
    assert.equal(response.binding_constraint, constraint);
    assert.equal(response.tier, "tier1");
  }
  return base;
}

// --- 1. Capacidad por vehículo ---------------------------------------------

test("vehicle_capacity: límites distintos por vehículo y el pago no los revierte", () => {
  assertSafetyInvariant(order({ vehicle: "bike", weight_kg: VEHICLES.bike.maxWeightKg + 0.1 }), "vehicle_capacity");
  assertSafetyInvariant(order({ vehicle: "moto", volume_liters: VEHICLES.moto.maxVolumeLiters + 1 }), "vehicle_capacity");

  // En la frontera exacta todavía cabe; el mismo paquete sí cabe en auto.
  assert.notEqual(run(order({ vehicle: "bike", weight_kg: VEHICLES.bike.maxWeightKg })).binding_constraint, "vehicle_capacity");
  assert.notEqual(run(order({ vehicle: "car", volume_liters: VEHICLES.moto.maxVolumeLiters + 1 })).binding_constraint, "vehicle_capacity");
  assert.ok(new Set(Object.values(VEHICLES).map((v) => v.speedKmh)).size === 3, "tres perfiles de velocidad distintos");
});

// --- 2. Zona marcada de noche ----------------------------------------------

test("flagged_zone_night: entrega en zona marcada después de las 22:00", () => {
  const flagged = FLAGGED_ZONES[0];
  const response = assertSafetyInvariant(order({ sim_time: "2026-03-21T21:45:00", zone_dropoff: flagged, courier_state_overrides: { shift_end_time: "2026-03-22T02:00:00" } }), "flagged_zone_night");
  assert.match(response.reason, /22:00/);

  assert.notEqual(run(order({ sim_time: "2026-03-21T20:00:00", zone_dropoff: flagged })).binding_constraint, "flagged_zone_night");
  assert.notEqual(
    run(order({ sim_time: "2026-03-21T22:30:00", zone_dropoff: 12, courier_state_overrides: { shift_end_time: "2026-03-22T02:00:00" } })).binding_constraint,
    "flagged_zone_night"
  );
});

// --- 3. Descanso obligatorio -----------------------------------------------

test("mandatory_break: 4 horas continuas exigen descanso", () => {
  const response = assertSafetyInvariant(order({ sim_time: "2026-03-21T19:00:00", courier_state_overrides: { continuous_riding_min: 235 } }), "mandatory_break");
  assert.match(response.reason, /descanso/);
  assert.equal(run(order({ sim_time: "2026-03-21T19:00:00", courier_state_overrides: { continuous_riding_min: 60 } })).binding_constraint, null);
});

// --- 4. Regla de calor -----------------------------------------------------

test("heat_rule: 90 min continuos entre 12:00 y 16:00, incluso si el límite se cruza al entrar a la ventana", () => {
  assertSafetyInvariant(order({ sim_time: "2026-03-21T13:00:00", courier_state_overrides: { continuous_riding_min: 85 } }), "heat_rule");
  assertSafetyInvariant(order({ sim_time: "2026-03-21T11:50:00", courier_state_overrides: { continuous_riding_min: 85 } }), "heat_rule");
  // Fuera de la ventana, la misma conducción continua es válida.
  assert.equal(run(order({ sim_time: "2026-03-21T17:00:00", courier_state_overrides: { continuous_riding_min: 85 } })).binding_constraint, null);
});

// --- 5. Fin de turno (leído del estado, nunca fijo) ------------------------

test("shift_end_infeasible: usa el fin de turno del estado", () => {
  const request = order({ sim_time: "2026-03-21T22:40:00", zone_dropoff: 12, courier_state_overrides: { shift_end_time: "2026-03-21T22:50:00" } });
  const response = assertSafetyInvariant(request, "shift_end_infeasible");
  assert.match(response.reason, /22:50/);

  const later = run({ ...request, courier_state_overrides: { ...request.courier_state_overrides, shift_end_time: "2026-03-21T23:59:00" } });
  assert.notEqual(later.binding_constraint, "shift_end_infeasible");
});

// --- 6. Consistencia en el umbral ------------------------------------------

test("threshold consistency: empate exacto acepta, un centavo más rechaza, siempre igual", () => {
  const request = order();
  const rate = run(request).economics.adjusted_rate_mxn_hr;

  assert.equal(run(request, rate).decision, "ACCEPT");
  const skip = run(request, rate + 0.01);
  assert.equal(skip.decision, "SKIP");
  assert.equal(skip.binding_constraint, "reservation_wage");
  for (let i = 0; i < 20; i++) assert.deepEqual(run(request, rate + 0.01), skip);
});

// --- 7. Valor de la zona de destino ----------------------------------------

test("dropoff location value: el mismo pedido vale menos si termina donde casi no hay pedidos", () => {
  const outlook = (zoneId) => demandModel.tables.moto[zoneId][18];
  const zones = Object.keys(demandModel.tables.moto).map(Number).filter((z) => !FLAGGED_ZONES.includes(z));
  const busy = zones.reduce((a, b) => (outlook(b).expectedWaitMin < outlook(a).expectedWaitMin ? b : a));
  const quiet = zones.reduce((a, b) => (outlook(b).expectedWaitMin > outlook(a).expectedWaitMin ? b : a));

  const toBusy = run(order({ zone_dropoff: busy })).economics;
  const toQuiet = run(order({ zone_dropoff: quiet })).economics;
  assert.equal(toBusy.raw_rate_mxn_hr, toQuiet.raw_rate_mxn_hr, "mismo pago y tiempo del pedido");
  assert.ok(toQuiet.adjusted_rate_mxn_hr < toBusy.adjusted_rate_mxn_hr);

  const wage = (toQuiet.adjusted_rate_mxn_hr + toBusy.adjusted_rate_mxn_hr) / 2;
  assert.equal(run(order({ zone_dropoff: busy }), wage).decision, "ACCEPT");
  assert.equal(run(order({ zone_dropoff: quiet }), wage).decision, "SKIP");
});

// --- 8. Apilado y factibilidad de ruta -------------------------------------

test("stacking: considera la ruta combinada, la carga combinada y las horas prometidas", () => {
  const inFlight = (overrides = {}) => ({
    order_id: "ORD-IN",
    zone_dropoff: 1,
    remaining_min: 10,
    delivery_deadline: "2026-03-21T19:00:00",
    weight_kg: 3,
    volume_liters: 10,
    ...overrides,
  });

  const feasible = run(order({ courier_state_overrides: { in_flight_orders: [inFlight()] } }));
  assert.notEqual(feasible.reason.includes("Apilar no es factible"), true);

  // Terminar primero el pedido en curso entrega el nuevo a las 18:19 (plazo 18:15);
  // recoger primero el nuevo retrasa el que ya lleva (plazo 18:12). Ninguno sirve.
  const late = run(
    order({
      delivery_deadline: "2026-03-21T18:15:00",
      distance_pickup_km: 6,
      courier_state_overrides: { in_flight_orders: [inFlight({ delivery_deadline: "2026-03-21T18:12:00" })] },
    })
  );
  assert.equal(late.decision, "SKIP");
  assert.match(late.reason, /Apilar no es factible/);

  const heavy = run(order({ weight_kg: 10, courier_state_overrides: { in_flight_orders: [inFlight({ remaining_min: 60, delivery_deadline: "2026-03-21T20:30:00" })] } }));
  assert.ok(["vehicle_capacity", null].includes(heavy.binding_constraint));

  const full = run(order({ courier_state_overrides: { in_flight_orders: Array.from({ length: MAX_IN_FLIGHT_ORDERS }, (_, i) => inFlight({ order_id: `IN-${i}` })) } }));
  assert.equal(full.decision, "SKIP");
});

// --- Determinismo, replay, formato y latencia -------------------------------

test("misma seed → flujo de pedidos idéntico byte a byte; seeds distintas → distinto", () => {
  const config = { seed: 1234, shift_hours: 8, vehicle: "moto", start_location_zone: 7 };
  assert.equal(streamSha256(generateShift(config)), streamSha256(generateShift(config)));
  assert.notEqual(streamSha256(generateShift(config)), streamSha256(generateShift({ ...config, seed: 1235 })));
  for (const vehicle of ["moto", "car", "bike"]) assert.ok(generateShift({ ...config, vehicle }).orders.length > 0);
});

test("seeds de ajuste y de reporte son disjuntas", () => {
  assert.equal(TUNING_SEEDS.filter((s) => REPORTING_SEEDS.includes(s)).length, 0);
  assert.ok(REPORTING_SEEDS.length >= 10);
});

test("un turno completo: 0 violaciones, razones ≤40 palabras, constraint válido, replay idéntico, p99 < 50 ms", async () => {
  const strategy = { reservation_wage_mxn_hr: 80, degraded: false };
  const fixedStrategy = { current: () => strategy, refresh: async () => strategy };
  for (const config of TUNING_CONFIGS.slice(0, 6)) {
    const shift = await runShift(config, ourAgent({ demandModel, strategyClient: fixedStrategy }));
    assert.equal(shift.metrics.safety_violations, 0, `seed ${config.seed}`);
    assert.ok(shift.metrics.p99_latency_ms < 50);

    for (const event of shift.events.filter((e) => e.event === "decision")) {
      assert.ok(event.reason.split(/\s+/).length <= 40, event.reason);
      assert.ok(CONSTRAINTS.has(event.binding_constraint));
    }

    const replay = replayEvents(shift.events, { demandModel });
    assert.ok(replay.compared > 0);
    assert.deepEqual(replay.mismatches, []);
  }
});

test("el replay detecta si la decisión grabada no corresponde a la entrada", async () => {
  const strategy = { reservation_wage_mxn_hr: 80, degraded: false };
  const shift = await runShift(TUNING_CONFIGS[1], ourAgent({ demandModel, strategyClient: { current: () => strategy, refresh: async () => strategy } }));
  const tampered = shift.events.map((e) => (e.event === "decision" && e.decision === "SKIP" ? { ...e, decision: "ACCEPT" } : e));
  assert.ok(replayEvents(tampered, { demandModel }).mismatches.length > 0);
});

test("baselines pueden violar seguridad; el agente no; el Oracle es cota superior de ganancia", async () => {
  const strategy = { reservation_wage_mxn_hr: 80, degraded: false };
  let baselineViolations = 0;
  for (const config of TUNING_CONFIGS.slice(0, 9)) {
    const agent = await runShift(config, ourAgent({ demandModel, strategyClient: { current: () => strategy, refresh: async () => strategy } }));
    const all = await runShift(config, acceptAll());
    const oracle = await runShift(config, planPolicy(solveOracle(config).plan), { enforceBreaks: false });
    baselineViolations += all.metrics.safety_violations;
    assert.equal(agent.metrics.safety_violations, 0);
    assert.ok(oracle.metrics.earnings_mxn + 1e-6 >= agent.metrics.earnings_mxn, `seed ${config.seed}`);
  }
  assert.ok(baselineViolations > 0, "AcceptAll debe mostrar por qué hacen falta las reglas");
});

test("modelo inalcanzable: el fast path sigue decidiendo al instante y se marca degradado", async () => {
  const client = new StrategyClient({ baseUrl: "http://127.0.0.1:9", timeoutMs: 100 });
  const strategy = await client.refresh({ vehicle: "moto", sim_time: "2026-03-21T18:00:00", shift_start_time: "2026-03-21T15:00:00", shift_end_time: "2026-03-21T23:00:00" });
  assert.equal(strategy.degraded, true);

  const started = process.hrtime.bigint();
  const response = decide(order(), { demandModel, strategy: client.current() }).response;
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50);
  assert.equal(response.degraded, true);
  assert.ok(["ACCEPT", "SKIP"].includes(response.decision));
});
