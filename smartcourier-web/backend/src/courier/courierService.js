// Estado del agente en vivo para los endpoints (/decide, /explain, /status,
// /shock, /shift/start, /replay). La decisión nunca espera al modelo: el
// tier 2 se consulta en segundo plano (al iniciar turno, con cada shock y
// periódicamente) y el fast path lee la última estrategia disponible.
const fs = require("fs");
const path = require("path");
const StrategyClient = require("./strategyClient");
const { decide, resolveCourierState } = require("./fastPath");
const { loadDemandModel } = require("./demandModel");
const { normalizeConfig } = require("./orderStream");
const { normalizeShock, activeShocks, toSeconds, toIso, round2 } = require("./world");
const { replayEvents, parseJsonl } = require("./replay");
const { VEHICLES } = require("./config");

const SHOCK_TYPES = ["surge", "closure", "rain", "delay"];
const DEFAULT_SHIFT_HOURS = 8;
const STRATEGY_REFRESH_MS = 60 * 1000;
const LATENCY_WINDOW = 500;
const DECISION_LOG = process.env.COURIER_DECISION_LOG || path.join(__dirname, "../../logs/courier_decisions.jsonl");

class CourierService {
  constructor({ strategyClient = new StrategyClient(), decisionLogPath = DECISION_LOG } = {}) {
    this.strategyClient = strategyClient;
    this.decisionLogPath = decisionLogPath;
    this.liveState = null;
    this.shift = null;
    this.shocks = [];
    this.explanations = new Map();
    this.latencies = [];
    this.lastSimTime = null;
    this.timer = null;
    this.loadDecisionLog();
  }

  // Las explicaciones sobreviven a un reinicio: se leen del log en disco.
  loadDecisionLog() {
    if (!fs.existsSync(this.decisionLogPath)) return;
    for (const line of fs.readFileSync(this.decisionLogPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        this.explanations.set(record.order_id, record);
      } catch (error) {
        // línea corrupta (p. ej. corte a mitad de escritura): se ignora
      }
    }
  }

  startPeriodicRefresh() {
    if (this.timer) return;
    this.timer = setInterval(() => this.refreshStrategy(), STRATEGY_REFRESH_MS);
    this.timer.unref();
  }

  stopPeriodicRefresh() {
    clearInterval(this.timer);
    this.timer = null;
  }

  startShift(config) {
    const cfg = normalizeConfig(config);
    this.shift = cfg;
    this.shocks = [];
    this.liveState = {
      shift_end_time: cfg.shift_end_time,
      current_zone: cfg.start_location_zone,
      continuous_riding_min: 0,
      shift_elapsed_hours: 0,
      last_break_end_time: null,
      in_flight_orders: [],
    };
    this.lastSimTime = cfg.shift_start_time;
    this.refreshStrategy();
    return { ...cfg, startSeconds: undefined, endSeconds: undefined };
  }

  strategyContext() {
    const simTime = this.lastSimTime || this.shift?.shift_start_time;
    if (!simTime || !this.shift) return null;
    return {
      vehicle: this.shift.vehicle,
      sim_time: simTime,
      shift_start_time: this.shift.shift_start_time,
      shift_end_time: this.liveState.shift_end_time,
      earnings_mxn: 0,
      orders_completed: 0,
      current_zone: this.liveState.current_zone,
      active_shocks: activeShocks(this.shocks, toSeconds(simTime)).map(({ start, end, ...s }) => s),
    };
  }

  async refreshStrategy() {
    const context = this.strategyContext();
    if (!context) return this.strategyClient.current();
    return this.strategyClient.refresh(context);
  }

  // Sin turno iniciado ni overrides, se abre uno por defecto desde el primer
  // ping; el fin de turno queda en el estado y de ahí se lee siempre.
  ensureShiftFor(request) {
    if (this.liveState || request.courier_state_overrides?.shift_end_time) return;
    const start = toSeconds(request.sim_time);
    this.startShift({
      seed: 0,
      shift_hours: DEFAULT_SHIFT_HOURS,
      vehicle: request.vehicle,
      start_location_zone: request.zone_pickup,
      shift_start_time: toIso(start),
    });
  }

  decide(request) {
    const startedAt = process.hrtime.bigint();
    this.ensureShiftFor(request);
    const { response, explain } = decide(request, {
      strategy: this.strategyClient.current(),
      demandModel: loadDemandModel(),
      shocks: this.shocks,
      liveState: this.liveState,
    });
    const latencyMs = round2(Number(process.hrtime.bigint() - startedAt) / 1e6);
    this.lastSimTime = request.sim_time;

    const result = { ...response, latency_ms: latencyMs };
    const record = { ...explain, latency_ms: latencyMs, binding_constraint: response.binding_constraint, tier: response.tier, degraded: response.degraded };
    this.explanations.set(request.order_id, record);
    this.latencies.push(latencyMs);
    if (this.latencies.length > LATENCY_WINDOW) this.latencies.shift();

    // Escritura fuera del camino de la respuesta.
    setImmediate(() => {
      fs.mkdir(path.dirname(this.decisionLogPath), { recursive: true }, () => {
        fs.appendFile(this.decisionLogPath, `${JSON.stringify(record)}\n`, () => {});
      });
    });
    return result;
  }

  explain(orderId) {
    return this.explanations.get(orderId) || null;
  }

  injectShock(event) {
    if (!SHOCK_TYPES.includes(event.shock_type)) {
      throw new Error(`shock_type debe ser uno de: ${SHOCK_TYPES.join(", ")}`);
    }
    if (!event.sim_time) throw new Error("sim_time es obligatorio");
    const shock = normalizeShock({ event: "shock", ...event });
    this.shocks.push(shock);
    this.lastSimTime = event.sim_time;
    this.refreshStrategy(); // en segundo plano: nunca bloquea decisiones
    return { accepted: true, shock: { ...event, event: "shock" } };
  }

  replay(jsonlText) {
    return replayEvents(parseJsonl(jsonlText), {
      demandModel: loadDemandModel(),
      onExplain: (record) => this.explanations.set(record.order_id, record),
    });
  }

  status() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const pct = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
    return {
      degraded: this.strategyClient.current().degraded,
      tier2: this.strategyClient.status(),
      shift: this.shift ? { ...this.shift, startSeconds: undefined, endSeconds: undefined } : null,
      courier_state: this.liveState ? resolveCourierState({}, this.liveState) : null,
      active_shocks: this.lastSimTime ? activeShocks(this.shocks, toSeconds(this.lastSimTime)).map(({ start, end, ...s }) => s) : [],
      decisions_logged: this.explanations.size,
      latency_ms: { p50: pct(0.5), p99: pct(0.99), budget: 50 },
      vehicles: Object.keys(VEHICLES),
    };
  }
}

let instance = null;

function getCourierService() {
  if (!instance) {
    instance = new CourierService();
    instance.startPeriodicRefresh();
  }
  return instance;
}

module.exports = {
  CourierService,
  getCourierService,
};
