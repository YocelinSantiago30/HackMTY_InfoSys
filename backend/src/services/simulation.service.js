const crypto = require("crypto");
const pool = require("../config/database");
const HttpError = require("../utils/httpError");
const logger = require("../utils/logger");
const SimulationEngine = require("../simulation/SimulationEngine");
const orderService = require("./order.service");
const metricsService = require("./metrics.service");
const userService = require("./user.service");
const persistence = require("./simulationPersistence.service");
const socketBus = require("../socket/socketBus");
const { SERVICE_AREA_CENTER } = require("../simulation/OrderGenerator");
const eventService = require("./event.service");

const MODES = ["DEMO", "FRESH", "CUSTOM"];
const DEMO_SEED = 42026; // sección 17: seed fija para poder repetir la demo exacta
// Duraciones en segundos de TURNO simulado. A 1x avanza 1 minuto simulado por
// segundo real: la demo de 3 horas dura 3 minutos (18 s a 10x).
const DEFAULT_DEMO_DURATION_SECONDS = 3 * 60 * 60;
const DEFAULT_DURATION_SECONDS = 8 * 60 * 60;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Motores activos en memoria de este proceso: simulationId -> SimulationEngine.
const engines = new Map();

function resolveSeed(mode, providedSeed) {
  if (mode === "DEMO") return DEMO_SEED;

  if (mode === "CUSTOM" && Number.isInteger(providedSeed)) {
    return providedSeed;
  }

  return crypto.randomInt(1, 2 ** 31); // FRESH, o CUSTOM sin seed explícita
}

async function createSimulation(userId, { mode, durationSeconds, seed } = {}) {
  if (!MODES.includes(mode)) {
    throw new HttpError(400, `mode debe ser uno de: ${MODES.join(", ")}`);
  }

  if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds <= 0)) {
    throw new HttpError(400, "durationSeconds debe ser un entero positivo");
  }

  const finalSeed = resolveSeed(mode, seed);
  const finalDuration =
    durationSeconds || (mode === "DEMO" ? DEFAULT_DEMO_DURATION_SECONDS : DEFAULT_DURATION_SECONDS);

  const result = await pool.query(
    `INSERT INTO simulation_sessions (user_id, seed, mode, simulation_duration_seconds)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, finalSeed, mode, finalDuration]
  );

  return result.rows[0];
}

async function getOwnedSimulation(userId, simulationId) {
  if (!UUID_REGEX.test(simulationId)) {
    throw new HttpError(400, "ID de simulación inválido");
  }

  const result = await pool.query("SELECT * FROM simulation_sessions WHERE id = $1", [
    simulationId,
  ]);
  const simulation = result.rows[0];

  if (!simulation) {
    throw new HttpError(404, "Simulación no encontrada");
  }

  if (simulation.user_id !== userId) {
    throw new HttpError(403, "No tienes acceso a esta simulación");
  }

  return simulation;
}

async function ensureAgentStates(simulationId) {
  const agents = await pool.query("SELECT id FROM agents");

  for (const agent of agents.rows) {
    await pool.query(
      `INSERT INTO agent_states (simulation_id, agent_id, current_lat, current_lng)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (simulation_id, agent_id) DO NOTHING`,
      [simulationId, agent.id, SERVICE_AREA_CENTER.lat, SERVICE_AREA_CENTER.lng]
    );
  }
}

async function buildEngine(simulationRow, { restore = false } = {}) {
  const engine = new SimulationEngine({
    simulation: simulationRow,
    preferences: await userService.getPreferences(simulationRow.user_id),
    agentIds: await persistence.getAgentIds(),
    onAutoFinish: (id) => finishSimulation(id),
  });

  if (!restore) {
    await engine.prepare();
  } else if (!(await engine.restore())) {
    throw new HttpError(409, "Esta simulación se creó antes de poder recuperarse tras un reinicio; inicia una nueva");
  }

  return engine;
}

// Al arrancar el servidor, las simulaciones que estaban en curso perdieron
// su motor en memoria: se marcan en pausa para reanudarlas desde su snapshot.
async function markInterruptedSimulations() {
  const result = await pool.query(
    "UPDATE simulation_sessions SET status = 'PAUSED' WHERE status = 'RUNNING' RETURNING id"
  );
  if (result.rowCount > 0) {
    logger.simulation(`${result.rowCount} simulación(es) interrumpida(s) quedaron en pausa para reanudarse`);
  }
}

async function startSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "CREATED") {
    throw new HttpError(409, `No se puede iniciar una simulación en estado ${simulation.status}`);
  }

  await ensureAgentStates(simulationId);

  // Genera la lista única de pedidos (con rutas OSRM) antes de marcarla en
  // curso: si falla, la simulación no queda "RUNNING" sin motor.
  const engine = await buildEngine(simulation);

  const updated = await pool.query(
    `UPDATE simulation_sessions
     SET status = 'RUNNING', started_at = now()
     WHERE id = $1
     RETURNING *`,
    [simulationId]
  );

  const row = updated.rows[0];
  engines.set(simulationId, engine);
  engine.start();

  socketBus.emitToSimulation(simulationId, "simulation_started", { simulationId, ...row });

  return row;
}

async function pauseSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "RUNNING") {
    throw new HttpError(409, `No se puede pausar una simulación en estado ${simulation.status}`);
  }

  engines.get(simulationId)?.pause();

  const updated = await pool.query(
    "UPDATE simulation_sessions SET status = 'PAUSED' WHERE id = $1 RETURNING *",
    [simulationId]
  );

  socketBus.emitToSimulation(simulationId, "simulation_paused", { simulationId, ...updated.rows[0] });

  return updated.rows[0];
}

async function resumeSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "PAUSED") {
    throw new HttpError(409, `No se puede reanudar una simulación en estado ${simulation.status}`);
  }

  let engine = engines.get(simulationId);

  if (!engine) {
    // El proceso se reinició y perdió el motor en memoria: se continúa desde
    // el último snapshot confirmado (rutas, progreso, reloj, tráfico, RNG).
    engine = await buildEngine(simulation, { restore: true });
    engines.set(simulationId, engine);
  }

  engine.start();

  const updated = await pool.query(
    "UPDATE simulation_sessions SET status = 'RUNNING' WHERE id = $1 RETURNING *",
    [simulationId]
  );

  socketBus.emitToSimulation(simulationId, "simulation_resumed", { simulationId, ...updated.rows[0] });

  return updated.rows[0];
}

async function stopSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (!["RUNNING", "PAUSED"].includes(simulation.status)) {
    throw new HttpError(409, `No se puede detener una simulación en estado ${simulation.status}`);
  }

  return finishSimulation(simulationId);
}

async function finishSimulation(simulationId, status = "FINISHED") {
  const engine = engines.get(simulationId);
  if (engine) {
    await engine.finish();
    engines.delete(simulationId);
  }

  const updated = await pool.query(
    `UPDATE simulation_sessions
     SET status = $2, finished_at = now()
     WHERE id = $1 AND status IN ('RUNNING', 'PAUSED')
     RETURNING *`,
    [simulationId, status]
  );

  const finalRow = updated.rows[0];
  if (!finalRow) {
    // Ya estaba finalizada (p. ej. "Detener" y fin automático al mismo tiempo).
    const current = await pool.query("SELECT * FROM simulation_sessions WHERE id = $1", [simulationId]);
    return current.rows[0];
  }

  logger.simulation(`Simulación ${simulationId} finalizada (${status})`);
  await metricsService.snapshotMetrics(simulationId, finalRow.current_simulation_second / 60);
  socketBus.emitToSimulation(simulationId, "simulation_finished", { simulationId, ...finalRow });

  return finalRow;
}

async function getSimulation(userId, simulationId) {
  return getOwnedSimulation(userId, simulationId);
}

async function listOrders(userId, simulationId) {
  await getOwnedSimulation(userId, simulationId); // valida acceso
  return orderService.listOrdersForSimulation(simulationId);
}

async function getComparison(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);
  return metricsService.getComparison(simulationId, simulation.current_simulation_second / 60);
}

async function setSpeed(userId, simulationId, speed) {
  await getOwnedSimulation(userId, simulationId);

  if (!SimulationEngine.VALID_SPEEDS.includes(speed)) {
    throw new HttpError(400, `speed debe ser uno de: ${SimulationEngine.VALID_SPEEDS.join(", ")}`);
  }

  const updated = await pool.query(
    "UPDATE simulation_sessions SET speed_multiplier = $2 WHERE id = $1 RETURNING *",
    [simulationId, speed]
  );

  const engine = engines.get(simulationId);
  if (engine) {
    engine.setSpeed(speed);
  } else {
    socketBus.emitToSimulation(simulationId, "simulation_speed_changed", { simulationId, speed });
  }

  return updated.rows[0];
}

async function listSimulations(userId, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const result = await pool.query(
    `SELECT * FROM simulation_sessions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, safeOffset]
  );

  return result.rows;
}

async function injectEvent(userId, simulationId, eventType, payload = {}) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "RUNNING") {
    throw new HttpError(
      409,
      `No se pueden inyectar eventos en una simulación en estado ${simulation.status}`
    );
  }

  if (!eventService.VALID_EVENT_TYPES.includes(eventType)) {
    throw new HttpError(400, `eventType debe ser uno de: ${eventService.VALID_EVENT_TYPES.join(", ")}`);
  }

  const engine = engines.get(simulationId);
  if (!engine) {
    throw new HttpError(409, "El motor de esta simulación no está activo en este proceso");
  }

  const effect = await engine.applyEvent(eventType, payload);
  const event = await eventService.recordEvent({
    simulationId,
    eventType,
    payload,
    currentSecond: Math.round(engine.currentSecond),
  });

  socketBus.emitToSimulation(simulationId, "simulation_event", {
    simulationId,
    eventType,
    payload,
    occurredAtSimulationSecond: Math.round(engine.currentSecond),
    effect,
  });

  logger.event(`Simulación ${simulationId}: ${eventType} inyectado (segundo ${Math.round(engine.currentSecond)})`);

  return { event, effect };
}

module.exports = {
  createSimulation,
  startSimulation,
  pauseSimulation,
  resumeSimulation,
  stopSimulation,
  getSimulation,
  listOrders,
  getComparison,
  setSpeed,
  listSimulations,
  injectEvent,
  markInterruptedSimulations,
};
