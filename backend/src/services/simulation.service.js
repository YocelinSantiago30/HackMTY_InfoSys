const crypto = require("crypto");
const pool = require("../config/database");
const HttpError = require("../utils/httpError");
const logger = require("../utils/logger");
const SimulationEngine = require("../simulation/SimulationEngine");
const orderService = require("./order.service");
const metricsService = require("./metrics.service");
const socketBus = require("../socket/socketBus");
const { SERVICE_AREA_CENTER } = require("../simulation/OrderGenerator");
const eventService = require("./event.service");

const MODES = ["DEMO", "FRESH", "CUSTOM"];
const DEMO_SEED = 42026; // sección 17: seed fija para poder repetir la demo exacta
const DEFAULT_DEMO_DURATION_SECONDS = 180; // sección 46: demo de ~3 minutos
const DEFAULT_DURATION_SECONDS = 1800;
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

async function buildEngine(simulationRow) {
  const orderCount = await orderService.countOrders(simulationRow.id);

  return new SimulationEngine({
    id: simulationRow.id,
    userId: simulationRow.user_id,
    seed: Number(simulationRow.seed),
    durationSeconds: simulationRow.simulation_duration_seconds,
    currentSecond: simulationRow.current_simulation_second,
    initialOrderNumber: orderCount,
    onAutoFinish: (id) => finishSimulation(id),
  });
}

async function startSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "CREATED") {
    throw new HttpError(409, `No se puede iniciar una simulación en estado ${simulation.status}`);
  }

  await ensureAgentStates(simulationId);

  const updated = await pool.query(
    `UPDATE simulation_sessions
     SET status = 'RUNNING', started_at = now()
     WHERE id = $1
     RETURNING *`,
    [simulationId]
  );

  const row = updated.rows[0];
  const engine = await buildEngine(row);
  engine.start();
  engines.set(simulationId, engine);

  socketBus.emitToSimulation(simulationId, "simulation_started", row);

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

  socketBus.emitToSimulation(simulationId, "simulation_paused", updated.rows[0]);

  return updated.rows[0];
}

async function resumeSimulation(userId, simulationId) {
  const simulation = await getOwnedSimulation(userId, simulationId);

  if (simulation.status !== "PAUSED") {
    throw new HttpError(409, `No se puede reanudar una simulación en estado ${simulation.status}`);
  }

  let engine = engines.get(simulationId);

  if (!engine) {
    // El proceso se reinició y perdió el motor en memoria: lo reconstruimos
    // desde el último segundo persistido en la base.
    engine = await buildEngine(simulation);
    engines.set(simulationId, engine);
  }

  engine.start();

  const updated = await pool.query(
    "UPDATE simulation_sessions SET status = 'RUNNING' WHERE id = $1 RETURNING *",
    [simulationId]
  );

  socketBus.emitToSimulation(simulationId, "simulation_resumed", updated.rows[0]);

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
  engines.get(simulationId)?.pause();
  engines.delete(simulationId);

  const updated = await pool.query(
    `UPDATE simulation_sessions
     SET status = $2, finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [simulationId, status]
  );

  logger.simulation(`Simulación ${simulationId} finalizada (${status})`);

  const finalRow = updated.rows[0];
  await metricsService.snapshotMetrics(simulationId, finalRow.current_simulation_second / 60);

  socketBus.emitToSimulation(simulationId, "simulation_finished", finalRow);

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

  const event = await eventService.recordEvent({
    simulationId,
    eventType,
    payload,
    currentSecond: engine.currentSecond,
  });

  const effect = await engine.applyEvent(eventType, payload);

  socketBus.emitToSimulation(simulationId, "simulation_event", {
    eventType,
    payload,
    occurredAtSimulationSecond: engine.currentSecond,
    effect,
  });

  logger.event(`Simulación ${simulationId}: ${eventType} inyectado (segundo ${engine.currentSecond})`);

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
  listSimulations,
  injectEvent,
};
