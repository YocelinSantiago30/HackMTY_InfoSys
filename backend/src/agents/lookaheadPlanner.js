// ¿Aceptar este pedido o seguir libre esperando otro? En lugar de una banda
// fija de puntaje, SmartCourier simula ambas opciones DESDE EL MISMO ESTADO
// (posición, ruta, tráfico vigente, eventos activos) sobre varios escenarios
// de demanda futura.
//
// Reglas para que no sea trampa:
// - los pedidos futuros son sintéticos (misma distribución, otra semilla):
//   nunca se miran los pedidos reales que todavía no llegan;
// - el tráfico futuro es el pronóstico típico por hora + el evento vigente,
//   no el calendario real;
// - ambas opciones usan los MISMOS escenarios, así la diferencia mide la
//   decisión y no la suerte del escenario.
//
// Valor de una opción = ganancia neta dentro del horizonte − minutos extra
// después del horizonte × costo de oportunidad (lo que se deja de ganar por
// seguir ocupado). Ese costo es el "costo de esperar" calibrado con
// scripts/compareStrategies.js en seeds de entrenamiento.
const SimulationRandomService = require("../simulation/SimulationRandomService");
const { generateOrderStream } = require("../simulation/OrderGenerator");
const { estimateRoute } = require("../services/routing.service");

const DEFAULT_LOOKAHEAD = {
  horizonSeconds: 45 * 60,
  scenarios: 6,
  opportunityCostPerMinute: 2.5,
};

const SYNTHETIC_ORDER_NUMBER_START = 1_000_000;
const estimateRouteAsync = async (params) => estimateRoute(params);

function scenarioSeed(seed, orderNumber, scenario) {
  let h = (Number(seed) ^ 0x27d4eb2f) >>> 0;
  h = Math.imul(h ^ orderNumber, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (scenario + 1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function round2(value) {
  return Number(value.toFixed(2));
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { mean: round2(mean), p10: round2(at(0.1)), p90: round2(at(0.9)), std: round2(Math.sqrt(variance)) };
}

const netOf = (counters) => counters.grossEarnings - counters.operatingCost;

async function runBranch({ core, baseSnapshot, stream, end, acceptPlan, order, config }) {
  const snapshot = JSON.parse(JSON.stringify(baseSnapshot));
  const agent = snapshot.agents.SMARTCOURIER;

  if (acceptPlan) {
    agent.plan = JSON.parse(JSON.stringify(acceptPlan));
    agent.commitments[order.external_order_number] = {
      promisedSecond: acceptPlan.stops[acceptPlan.stops.length - 1].arriveSecond,
      acceptedSecond: core.clock,
    };
  }

  const rollout = core.constructor.fromSnapshot({
    snapshot,
    simulationOrders: stream,
    options: {
      simulationId: "lookahead",
      seed: core.seed,
      durationSeconds: end,
      preferences: core.preferences,
      getRoute: estimateRouteAsync,
      agentCodes: ["SMARTCOURIER"],
      smartPolicy: "score",
      smartThresholds: core.smartThresholds,
      batchLimits: core.batchLimits,
    },
  });

  const before = agent.counters;
  await rollout.advanceTo(end);
  await rollout.finishShift();
  const after = rollout.agents.SMARTCOURIER.counters;

  const overtime = after.overtimeMinutes - before.overtimeMinutes;
  return netOf(after) - netOf(before) - overtime * config.opportunityCostPerMinute;
}

async function compareAcceptVsWait({ core, order, acceptPlan, config = DEFAULT_LOOKAHEAD }) {
  const end = core.clock + config.horizonSeconds;
  const full = core.toSnapshot();
  const baseSnapshot = {
    ...full,
    nextOrderIndex: 0,
    traffic: core.traffic.forecastFrom(core.clock).toJSON(),
    agents: { SMARTCOURIER: full.agents.SMARTCOURIER },
  };

  const accept = [];
  const wait = [];
  for (let k = 0; k < config.scenarios; k++) {
    const stream = await generateOrderStream({
      random: new SimulationRandomService(scenarioSeed(core.seed, order.external_order_number, k)),
      fromSecond: core.clock,
      toSecond: end,
      firstOrderNumber: SYNTHETIC_ORDER_NUMBER_START,
      getRoute: estimateRouteAsync,
    });

    accept.push(await runBranch({ core, baseSnapshot, stream, end, acceptPlan, order, config }));
    wait.push(await runBranch({ core, baseSnapshot, stream, end, acceptPlan: null, order, config }));
  }

  const advantage = summarize(accept.map((value, i) => value - wait[i]));
  return {
    horizonMinutes: config.horizonSeconds / 60,
    scenarios: config.scenarios,
    opportunityCostPerMinute: config.opportunityCostPerMinute,
    accept: summarize(accept),
    wait: summarize(wait),
    acceptAdvantage: advantage.mean,
    advantageP10: advantage.p10,
    advantageP90: advantage.p90,
  };
}

module.exports = {
  compareAcceptVsWait,
  DEFAULT_LOOKAHEAD,
};
