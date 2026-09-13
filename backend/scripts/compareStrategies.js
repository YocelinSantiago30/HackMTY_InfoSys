// Compara Baseline vs SmartCourier con exactamente la misma física
// (SimulationCore), sin red ni base de datos: las rutas usan el estimador
// determinista calibrado contra OSRM.
//
// Uso:
//   node scripts/compareStrategies.js           # reporte en seeds de PRUEBA
//   node scripts/compareStrategies.js --grid    # calibración en seeds de ENTRENAMIENTO
//
// Los parámetros se eligen solo con entrenamiento y se reportan en seeds
// distintas. Se mide ganancia neta por hora REAL trabajada (turno + horas
// extra para terminar entregas), retrasos contra la hora comprometida, error
// de ETA y la variación entre seeds; no solo el puntaje.
const SimulationCore = require("../src/simulation/SimulationCore");
const { estimateRoute } = require("../src/services/routing.service");
const { DEFAULT_THRESHOLDS } = require("../src/agents/smartCourierAgent");
const { DEFAULT_LOOKAHEAD } = require("../src/agents/lookaheadPlanner");

const SHIFT_SECONDS = 3 * 60 * 60;
const TRAIN_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const TEST_SEEDS = [42026, ...Array.from({ length: 40 }, (_, i) => i + 1001)];

// Escenarios de eventos (mismos para ambos agentes).
const SCENARIOS = {
  normal: [],
  trafico_severo: [
    { at: 60 * 60, type: "TRAFFIC_INCREASED", payload: { level: "SEVERE" } },
    { at: 105 * 60, type: "TRAFFIC_DECREASED" },
  ],
  cierre_vial: [
    { at: 45 * 60, type: "ROAD_CLOSED" },
    { at: 120 * 60, type: "ROAD_REOPENED" },
  ],
};

async function runSeed(seed, { events = [], vehicle = "motorcycle", ...options } = {}) {
  const core = new SimulationCore({
    simulationId: `offline-${seed}`,
    seed,
    durationSeconds: SHIFT_SECONDS,
    preferences: { vehicle_type: vehicle },
    getRoute: async (params) => estimateRoute(params),
    ...options,
  });
  await core.prepare();
  for (const event of events) {
    await core.advanceTo(event.at);
    await core.applyEvent(event.type, event.payload);
  }
  await core.advanceTo(SHIFT_SECONDS);
  await core.finishShift();

  const result = {};
  for (const [code, agent] of Object.entries(core.agents)) {
    const c = agent.counters;
    const net = c.grossEarnings - c.operatingCost;
    const workedHours = (SHIFT_SECONDS / 60 + c.overtimeMinutes) / 60;
    result[code] = {
      net,
      netPerWorkedHour: net / workedHours,
      km: c.distanceKm,
      completed: c.completedOrders,
      late: c.lateDeliveries,
      delayMinutes: c.totalDelayMinutes,
      etaErrorMinutes: c.totalEtaErrorMinutes,
      batched: c.batchedOrders,
    };
  }
  return result;
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const std = (values) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

async function summarize(seeds, options) {
  const rows = [];
  for (const seed of seeds) rows.push({ seed, ...(await runSeed(seed, options)) });

  const agent = (code) => {
    const pick = (key) => rows.map((r) => r[code][key]);
    const completed = pick("completed").reduce((a, b) => a + b, 0);
    return {
      net: mean(pick("net")),
      netStd: std(pick("net")),
      netPerWorkedHour: mean(pick("netPerWorkedHour")),
      netPerWorkedHourStd: std(pick("netPerWorkedHour")),
      km: mean(pick("km")),
      completed: completed / rows.length,
      lateRate: completed ? pick("late").reduce((a, b) => a + b, 0) / completed : 0,
      avgDelay: completed ? pick("delayMinutes").reduce((a, b) => a + b, 0) / completed : 0,
      avgEtaError: completed ? pick("etaErrorMinutes").reduce((a, b) => a + b, 0) / completed : 0,
      batched: mean(pick("batched")),
    };
  };

  return {
    rows,
    wins: rows.filter((r) => r.SMARTCOURIER.netPerWorkedHour > r.BASELINE.netPerWorkedHour).length,
    BASELINE: agent("BASELINE"),
    SMARTCOURIER: agent("SMARTCOURIER"),
  };
}

const f = (n, digits = 2) => n.toFixed(digits).padStart(8);

function printSummary(title, s, seedCount) {
  console.log(`\n${title}`);
  console.log("                      neto        ±std    neto/h trab    ±std     km   entregas  tarde%  retraso/ent  errorETA/ent");
  for (const code of ["BASELINE", "SMARTCOURIER"]) {
    const a = s[code];
    console.log(
      `  ${code.padEnd(13)} ${f(a.net)} ${f(a.netStd)} ${f(a.netPerWorkedHour)} ${f(a.netPerWorkedHourStd)} ${f(a.km, 1)} ${f(a.completed)} ${f(a.lateRate * 100, 1)} ${f(a.avgDelay)} min ${f(a.avgEtaError)} min`
    );
  }
  const gain = ((s.SMARTCOURIER.netPerWorkedHour - s.BASELINE.netPerWorkedHour) / s.BASELINE.netPerWorkedHour) * 100;
  console.log(`  SmartCourier: ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}% neto/hora trabajada; gana en ${s.wins}/${seedCount} seeds`);
}

async function grid() {
  const configs = [];
  for (const accept of [30, 40, 50]) {
    configs.push({ label: `score accept=${accept}`, smartPolicy: "score", smartThresholds: { ...DEFAULT_THRESHOLDS, accept } });
  }
  for (const opportunityCostPerMinute of [1.5, 2.5, 3.5, 4.5]) {
    for (const horizonMinutes of [45, 90]) {
      configs.push({
        label: `lookahead costo=${opportunityCostPerMinute}/min horizonte=${horizonMinutes}min`,
        smartPolicy: "lookahead",
        lookahead: { ...DEFAULT_LOOKAHEAD, opportunityCostPerMinute, horizonSeconds: horizonMinutes * 60 },
      });
    }
  }

  console.log(`Calibración en ${TRAIN_SEEDS.length} seeds de ENTRENAMIENTO (escenario normal):`);
  const results = [];
  for (const { label, ...options } of configs) {
    const s = await summarize(TRAIN_SEEDS, options);
    results.push({ label, s });
    console.log(
      `  ${label.padEnd(44)} smart neto/h=${f(s.SMARTCOURIER.netPerWorkedHour)} (±${s.SMARTCOURIER.netPerWorkedHourStd.toFixed(1)})  baseline=${f(s.BASELINE.netPerWorkedHour)}  tarde%=${(s.SMARTCOURIER.lateRate * 100).toFixed(1)}  gana ${s.wins}/${TRAIN_SEEDS.length}`
    );
  }
  const best = results.sort((a, b) => b.s.SMARTCOURIER.netPerWorkedHour - a.s.SMARTCOURIER.netPerWorkedHour)[0];
  console.log(`\nMejor en entrenamiento: ${best.label}`);
}

async function report() {
  console.log(`Seeds de PRUEBA: ${TEST_SEEDS.length} (no usadas para calibrar). Vehículo: moto salvo que se indique.`);

  for (const [name, events] of Object.entries(SCENARIOS)) {
    printSummary(`Escenario: ${name}`, await summarize(TEST_SEEDS, { events }), TEST_SEEDS.length);
  }

  printSummary(
    "Referencia: SmartCourier solo con puntaje (sin simular aceptar vs esperar), escenario normal",
    await summarize(TEST_SEEDS, { smartPolicy: "score" }),
    TEST_SEEDS.length
  );

  for (const vehicle of ["bike", "car"]) {
    printSummary(`Vehículo: ${vehicle}, escenario normal`, await summarize(TEST_SEEDS, { vehicle }), TEST_SEEDS.length);
  }
}

async function promises() {
  for (const promiseMethod of ["current", "forecast"]) {
    for (const [name, events] of Object.entries(SCENARIOS)) {
      printSummary(`ETA prometida=${promiseMethod}, escenario ${name} (ENTRENAMIENTO)`, await summarize(TRAIN_SEEDS, { events, promiseMethod }), TRAIN_SEEDS.length);
    }
  }
}

const mode = process.argv.includes("--grid") ? grid : process.argv.includes("--promises") ? promises : report;
mode().catch((error) => {
  console.error(error);
  process.exit(1);
});
