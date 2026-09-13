// Entrenamiento con las seeds de AJUSTE (nunca con las de reporte):
// 1. Modelo de demanda por zona/hora desde los flujos de pedidos generados.
// 2. Parámetros del agente de estrategia (tier 2): salario de reserva por
//    vehículo y franja horaria + ajustes por lluvia, surge y fin de turno,
//    buscados por descenso coordenado maximizando la ganancia neta media.
//    Cada evaluación consulta al servicio Python real (mismo código que en vivo).
// 3. Umbral del baseline GreedyRate (para compararnos con su mejor versión).
//
//   node scripts/courier/train.js
const fs = require("fs");
const path = require("path");
const { TUNING_CONFIGS, TUNING_SEEDS, REPORTING_SEEDS } = require("../../src/courier/seedSets");
const { generateShift } = require("../../src/courier/orderStream");
const { trainDemandModel, saveDemandModel, loadDemandModel } = require("../../src/courier/demandModel");
const { runShift, ourAgent } = require("../../src/courier/simulator");
const { greedyRate } = require("../../src/courier/baselines");
const StrategyClient = require("../../src/courier/strategyClient");
const { startModelService } = require("./modelService");

const MODELS_DIR = path.join(__dirname, "../../../models/courier");
const BANDS = ["morning", "lunch", "afternoon", "dinner", "night"];
const WAGE_GRID = [0, 40, 80, 120, 160, 200, 240, 280];

if (TUNING_SEEDS.some((seed) => REPORTING_SEEDS.includes(seed))) {
  throw new Error("Las seeds de ajuste y de reporte deben ser disjuntas");
}

function initialParams() {
  const vehicles = {};
  for (const vehicle of ["moto", "car", "bike"]) vehicles[vehicle] = Object.fromEntries(BANDS.map((b) => [b, 120]));
  return { vehicles, rain_factor: 1, surge_factor: 1, end_taper_minutes: 45, end_taper_factor: 1 };
}

function writeStrategyModel(params, extra = {}) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const version = `courier-strategy-${require("crypto").createHash("sha1").update(JSON.stringify(params)).digest("hex").slice(0, 8)}`;
  fs.writeFileSync(path.join(MODELS_DIR, "strategy_model.json"), `${JSON.stringify({ version, params, ...extra }, null, 2)}\n`);
  return version;
}

async function meanEarnings(configs, makePolicy) {
  const results = await Promise.all(configs.map((config) => runShift(config, makePolicy())));
  const violations = results.reduce((s, r) => s + r.metrics.safety_violations, 0);
  const mean = results.reduce((s, r) => s + r.metrics.earnings_mxn, 0) / results.length;
  return { mean, violations };
}

async function main() {
  const t0 = Date.now();
  console.log(`Seeds de AJUSTE: ${TUNING_SEEDS[0]}–${TUNING_SEEDS[TUNING_SEEDS.length - 1]} (${TUNING_CONFIGS.length} turnos)`);
  console.log(`Seeds de REPORTE (no se tocan aquí): ${REPORTING_SEEDS[0]}–${REPORTING_SEEDS[REPORTING_SEEDS.length - 1]}`);

  // 1. Modelo de demanda
  const demandModel = trainDemandModel(TUNING_CONFIGS.map(generateShift));
  saveDemandModel(demandModel);
  console.log(`Modelo de demanda entrenado con ${demandModel.trainedOnShifts} turnos`);

  // 3. GreedyRate (no necesita el modelo)
  let greedy = { threshold: null, mean: -Infinity };
  for (const threshold of WAGE_GRID) {
    const { mean } = await meanEarnings(TUNING_CONFIGS, () => greedyRate({ thresholdMxnHr: threshold }));
    if (mean > greedy.mean) greedy = { threshold, mean };
  }
  console.log(`GreedyRate: mejor umbral en ajuste $${greedy.threshold}/h`);

  // 2. Parámetros de estrategia vía el servicio Python real
  const params = initialParams();
  writeStrategyModel(params);
  const service = await startModelService();
  const evaluate = (configs, candidate) =>
    meanEarnings(configs, () =>
      ourAgent({
        demandModel: loadDemandModel(),
        strategyClient: new StrategyClient({ baseUrl: service.url, getApiKey: () => service.apiKey, paramsOverride: candidate, timeoutMs: 5000 }),
      })
    );

  try {
    const history = [];
    // Pasada 1: rejilla gruesa. Pasada 2: refinamiento ±20 y ±10 alrededor del mejor.
    const passes = [() => WAGE_GRID, (current) => [current - 20, current - 10, current, current + 10, current + 20].filter((v) => v >= 0)];
    for (const [passIndex, gridFor] of passes.entries()) {
      for (const vehicle of ["moto", "car", "bike"]) {
        const configs = TUNING_CONFIGS.filter((c) => c.vehicle === vehicle);
        for (const band of BANDS) {
          let best = { value: params.vehicles[vehicle][band], mean: -Infinity };
          for (const value of gridFor(params.vehicles[vehicle][band])) {
            const candidate = JSON.parse(JSON.stringify(params));
            candidate.vehicles[vehicle][band] = value;
            const { mean, violations } = await evaluate(configs, candidate);
            if (violations > 0) throw new Error(`El agente violó seguridad durante el ajuste (${vehicle} ${band}=${value})`);
            if (mean > best.mean + 1e-9) best = { value, mean };
          }
          params.vehicles[vehicle][band] = best.value;
          history.push({ pass: passIndex + 1, vehicle, band, value: best.value, mean: Number(best.mean.toFixed(2)) });
          console.log(`  pasada ${passIndex + 1} ${vehicle.padEnd(5)} ${band.padEnd(9)} reserva $${best.value}/h → neto medio $${best.mean.toFixed(2)}`);
        }
      }
    }

    for (const [key, grid] of [
      ["rain_factor", [0.7, 0.85, 1, 1.15]],
      ["surge_factor", [0.9, 1, 1.1, 1.25]],
      ["end_taper_factor", [0.5, 0.7, 0.85, 1]],
    ]) {
      let best = { value: params[key], mean: -Infinity };
      for (const value of grid) {
        const { mean } = await evaluate(TUNING_CONFIGS, { ...params, [key]: value });
        if (mean > best.mean + 1e-9) best = { value, mean };
      }
      params[key] = best.value;
      history.push({ param: key, value: best.value, mean: Number(best.mean.toFixed(2)) });
      console.log(`  ${key.padEnd(16)} = ${best.value} → neto medio $${best.mean.toFixed(2)}`);
    }

    const version = writeStrategyModel(params, { trained_on_seeds: TUNING_SEEDS, objective: "ganancia neta media por turno" });
    fs.writeFileSync(
      path.join(MODELS_DIR, "training_report.json"),
      `${JSON.stringify(
        {
          strategy_model_version: version,
          tuning_seeds: TUNING_SEEDS,
          reporting_seeds_excluded: REPORTING_SEEDS,
          greedy_rate_threshold_mxn_hr: greedy.threshold,
          search_history: history,
          elapsed_seconds: Math.round((Date.now() - t0) / 1000),
        },
        null,
        2
      )}\n`
    );
    console.log(`Modelo de estrategia ${version} guardado en models/courier/ (${Math.round((Date.now() - t0) / 1000)} s)`);
  } finally {
    await service.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
