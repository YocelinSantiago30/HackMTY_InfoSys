// Cliente del TIER 2 (agente de estrategia). Corre ENTRE pedidos, nunca
// dentro de la ventana de decisión: el fast path solo lee `current()`.
//
// Si el modelo no responde (red caída, credencial inválida, timeout), se
// conserva la última estrategia conocida, se marca `degraded: true` y el fast
// path sigue decidiendo sin esperar. Cuando el modelo vuelve, se recupera solo.
const axios = require("axios");

// Estrategia de arranque si el modelo nunca ha respondido: conservadora.
const BOOTSTRAP_STRATEGY = {
  reservation_wage_mxn_hr: 110,
  target_zone: null,
  reasoning: "Estrategia inicial por defecto: aún no hay respuesta del modelo de estrategia.",
  confidence: "low",
  model_version: "bootstrap",
};

const DEFAULT_TIMEOUT_MS = 800;

class StrategyClient {
  constructor({
    baseUrl = process.env.COURIER_MODEL_URL || "http://localhost:8000",
    getApiKey = () => process.env.COURIER_MODEL_API_KEY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    paramsOverride = null,
    initialStrategy = BOOTSTRAP_STRATEGY,
  } = {}) {
    this.baseUrl = baseUrl;
    this.getApiKey = getApiKey;
    this.timeoutMs = timeoutMs;
    this.paramsOverride = paramsOverride;
    this.strategy = { ...initialStrategy, degraded: true };
    this.lastError = "el modelo aún no se ha consultado";
    this.lastSuccessAt = null;
    this.consecutiveFailures = 0;
  }

  current() {
    return this.strategy;
  }

  // context: { vehicle, sim_time, shift_start_time, shift_end_time, earnings_mxn,
  //            orders_completed, current_zone, active_shocks }
  async refresh(context) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/strategy`,
        { ...context, params: this.paramsOverride },
        { timeout: this.timeoutMs, headers: { "X-Model-Key": this.getApiKey() || "" } }
      );
      this.strategy = { ...response.data, degraded: false };
      this.lastError = null;
      this.lastSuccessAt = context.sim_time;
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      this.lastError = error.response ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}` : error.message;
      this.strategy = {
        ...this.strategy,
        degraded: true,
        reasoning: "Modelo de estrategia no disponible: se mantiene la última estrategia conocida.",
      };
    }
    return this.strategy;
  }

  status() {
    return {
      degraded: this.strategy.degraded,
      last_error: this.lastError,
      last_success_sim_time: this.lastSuccessAt,
      consecutive_failures: this.consecutiveFailures,
      strategy: this.strategy,
    };
  }
}

module.exports = StrategyClient;
module.exports.BOOTSTRAP_STRATEGY = BOOTSTRAP_STRATEGY;
