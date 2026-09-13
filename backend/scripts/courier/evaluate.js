// Evaluación en seeds de REPORTE (disjuntas de las de ajuste) contra las
// baselines con nombre y el Oracle, y verificación de formatos con el
// validador oficial (courier/validate_format.py).
//
//   node scripts/courier/evaluate.js
//
// Escribe:

//   courier/results_table.csv          tabla de resultados (una diapositiva)
//   courier/results_by_vehicle.csv     desglose por vehículo
//   courier/output/*.jsonl             logs de turno del agente (validados)
//   courier/output/responses.json      respuestas de decisión (validadas)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { REPORTING_CONFIGS, REPORTING_SEEDS, TUNING_SEEDS } = require("../../src/courier/seedSets");
const { runShift, ourAgent, toJsonl, median } = require("../../src/courier/simulator");
const { acceptAll, highestPay, nearestFirst, greedyRate, planPolicy, withSafety } = require("../../src/courier/baselines");
const { solveOracle } = require("../../src/courier/oracle");
const { loadDemandModel } = require("../../src/courier/demandModel");
const { replayEvents } = require("../../src/courier/replay");
const StrategyClient = require("../../src/courier/strategyClient");
const { startModelService } = require("./modelService");

const COURIER_DIR = path.join(__dirname, "../../../courier");
const OUTPUT_DIR = path.join(COURIER_DIR, "output");
const REPORT = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../models/courier/training_report.json"), "utf8"));

if (TUNING_SEEDS.some((seed) => REPORTING_SEEDS.includes(seed))) throw new Error("Seeds de ajuste y reporte no son disjuntas");

const round2 = (n) => Math.round(n * 100) / 100;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

function summarize(policyName, runs) {
  const metric = (key) => runs.map((r) => r.metrics[key]);
  return {
    policy: policyName,
    mean_earnings_mxn: round2(mean(metric("earnings_mxn"))),
    median_earnings_mxn: round2(median(metric("earnings_mxn"))),
    mean_mxn_per_hr: round2(mean(metric("mxn_per_hr"))),
    accept_rate_pct: round2(mean(metric("accept_rate_pct"))),
    orders_completed: round2(mean(metric("orders_completed"))),
    deadhead_pct_of_km: round2(mean(metric("deadhead_pct_of_km"))),
    deadline_misses: metric("deadline_misses").reduce((a, b) => a + b, 0),
    safety_violations: metric("safety_violations").reduce((a, b) => a + b, 0),
  };
}

const COLUMNS = [
  "policy",
  "mean_earnings_mxn",
  "median_earnings_mxn",
  "mean_mxn_per_hr",
  "accept_rate_pct",
  "orders_completed",
  "deadhead_pct_of_km",
  "deadline_misses",
  "safety_violations",
];

function csv(rows, header) {
  return `${header}${COLUMNS.join(",")}\n${rows.map((r) => COLUMNS.map((c) => r[c]).join(",")).join("\n")}\n`;
}

async function main() {
  const demandModel = loadDemandModel();
  const service = await startModelService({ port: 8012 });
  const makeAgent = () =>
    ourAgent({ demandModel, strategyClient: new StrategyClient({ baseUrl: service.url, getApiKey: () => service.apiKey, timeoutMs: 5000 }) });

  const policies = [
    ["AcceptAll", () => acceptAll()],
    ["HighestPay", () => highestPay()],
    ["NearestFirst", () => nearestFirst()],
    ["GreedyRate", () => greedyRate({ thresholdMxnHr: REPORT.greedy_rate_threshold_mxn_hr })],
    ["AcceptAll+Safety", () => withSafety(acceptAll(), { demandModel })],
    ["GreedyRate+Safety", () => withSafety(greedyRate({ thresholdMxnHr: REPORT.greedy_rate_threshold_mxn_hr }), { demandModel })],
    ["OurAgent", makeAgent],
  ];

  const runsByPolicy = {};
  try {
    for (const [name, make] of policies) {
      runsByPolicy[name] = await Promise.all(REPORTING_CONFIGS.map((config) => runShift(config, make())));
    }
    runsByPolicy.Oracle = await Promise.all(
      REPORTING_CONFIGS.map((config) => runShift(config, planPolicy(solveOracle(config).plan), { enforceBreaks: false }))
    );
  } finally {
    await service.stop();
  }

  const order = ["AcceptAll", "HighestPay", "NearestFirst", "GreedyRate", "AcceptAll+Safety", "GreedyRate+Safety", "OurAgent", "Oracle"];
  const rows = order.map((name) => summarize(name, runsByPolicy[name]));
  const ours = rows.find((r) => r.policy === "OurAgent");
  const oracle = rows.find((r) => r.policy === "Oracle");

  const header = [
    "# Results criterion, Courier.",
    `# Reporting seeds (held-out, never tuned on): ${REPORTING_SEEDS[0]}-${REPORTING_SEEDS[REPORTING_SEEDS.length - 1]} (${REPORTING_CONFIGS.length} shifts: moto/car/bike x 4/6/8 h x start 10:00/15:00/18:00)`,
    `# Tuning seeds (demand model + strategy params + GreedyRate threshold): ${TUNING_SEEDS[0]}-${TUNING_SEEDS[TUNING_SEEDS.length - 1]}`,
    `# Strategy model: ${REPORT.strategy_model_version}. GreedyRate threshold tuned on tuning seeds: ${REPORT.greedy_rate_threshold_mxn_hr} MXN/h.`,
    "# earnings = net of fuel; mxn_per_hr over worked hours (shift + overtime); deadline_misses and safety_violations are totals over all shifts.",
    "# X+Safety = the same baseline forced through our five safety constraints (economics-vs-economics comparison).",
    "# Oracle = offline DP with full knowledge of orders and shocks; relaxes continuous-riding rules (upper bound, not a deployable policy).",
    `# OurAgent captures ${round2((100 * ours.mean_earnings_mxn) / oracle.mean_earnings_mxn)}% of the Oracle mean earnings.`,
    "",
  ].join("\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(COURIER_DIR, "results_table.csv"), csv(rows, header));

  const vehicleRows = [];
  for (const vehicle of ["moto", "car", "bike"]) {
    for (const name of order) {
      const runs = runsByPolicy[name].filter((r) => r.config.vehicle === vehicle);
      vehicleRows.push({ ...summarize(`${name}:${vehicle}`, runs) });
    }
  }
  fs.writeFileSync(path.join(COURIER_DIR, "results_by_vehicle.csv"), csv(vehicleRows, "# Same reporting seeds, split by vehicle.\n"));

  // Logs y respuestas del agente para el validador oficial.
  const logPaths = [];
  const responses = [];
  runsByPolicy.OurAgent.slice(0, 3).forEach((run) => {
    const file = path.join(OUTPUT_DIR, `shift_seed${run.config.seed}_${run.config.vehicle}_ouragent.jsonl`);
    fs.writeFileSync(file, toJsonl(run.events));
    logPaths.push(file);
  });
  for (const run of runsByPolicy.OurAgent) {
    for (const event of run.events.filter((e) => e.event === "decision")) {
      const { event: _, sim_time, ...response } = event;
      responses.push(response);
    }
  }
  const responsesPath = path.join(OUTPUT_DIR, "responses.json");
  fs.writeFileSync(responsesPath, `${JSON.stringify(responses, null, 1)}\n`);

  console.log(fs.readFileSync(path.join(COURIER_DIR, "results_table.csv"), "utf8"));

  // Replay: las decisiones grabadas deben reproducirse idénticas.
  for (const run of runsByPolicy.OurAgent) {
    const result = replayEvents(run.events, { demandModel });
    if (!result.identical) throw new Error(`Replay distinto en seed ${run.config.seed}: ${JSON.stringify(result.mismatches.slice(0, 3))}`);
  }
  console.log(`Replay: ${runsByPolicy.OurAgent.length} turnos re-decididos, 0 diferencias.`);

  const p99 = Math.max(...runsByPolicy.OurAgent.map((r) => r.metrics.p99_latency_ms));
  console.log(`Latencia fast path: p99 máximo ${p99} ms (presupuesto 50 ms).`);
  if (ours.safety_violations !== 0) throw new Error(`OurAgent tuvo ${ours.safety_violations} violaciones de seguridad`);

  const validator = path.join(COURIER_DIR, "validate_format.py");
  for (const file of logPaths) execFileSync("python3", [validator, "--event-log", file], { stdio: "inherit" });
  execFileSync("python3", [validator, "--responses", responsesPath], { stdio: "inherit" });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
