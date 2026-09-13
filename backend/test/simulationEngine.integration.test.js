// Pruebas con Postgres real y rutas estimadas (sin OSRM, para no depender de
// la red). Se limpian solas.
// - Sección 58: los estados de SmartCourier y Baseline son independientes y
//   lo persistido coincide con la memoria.
// - Recuperación: reiniciar el proceso a mitad del recorrido (e incluso morir
//   a mitad de una transacción) produce el mismo estado final que continuar
//   sin interrupción, sin cobros duplicados.
require("dotenv").config();
process.env.OSRM_BASE_URL = "";

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/config/database");
const SimulationEngine = require("../src/simulation/SimulationEngine");
const persistence = require("../src/services/simulationPersistence.service");

const SHIFT_SECONDS = 3 * 60 * 60;
const STEP_SECONDS = 150; // un tick a 10x
const created = [];

async function createSimulation(seed) {
  const user = await pool.query(
    "INSERT INTO users (name, email, password_hash) VALUES ('Test Runner', $1, 'x') RETURNING id",
    [`test-${Date.now()}-${Math.random()}@example.com`]
  );
  const simulation = (
    await pool.query(
      `INSERT INTO simulation_sessions (user_id, seed, mode, simulation_duration_seconds, status)
       VALUES ($1, $2, 'CUSTOM', $3, 'RUNNING') RETURNING *`,
      [user.rows[0].id, seed, SHIFT_SECONDS]
    )
  ).rows[0];
  created.push({ userId: user.rows[0].id, simulationId: simulation.id });

  for (const agentId of Object.values(await persistence.getAgentIds())) {
    await pool.query("INSERT INTO agent_states (simulation_id, agent_id) VALUES ($1, $2)", [simulation.id, agentId]);
  }
  return simulation;
}

async function newEngine(simulation) {
  return new SimulationEngine({ simulation, preferences: {}, agentIds: await persistence.getAgentIds() });
}

async function runUntil(engine, fromSecond, toSecond) {
  for (let second = fromSecond + STEP_SECONDS; second <= toSecond; second += STEP_SECONDS) {
    await engine.advance(second);
  }
}

async function finalState(simulationId) {
  const states = await persistence.loadAgentStates(simulationId);
  const agents = {};
  for (const s of states) {
    agents[s.code] = {
      earnings: Number(s.earnings).toFixed(4),
      cost: Number(s.operating_cost).toFixed(4),
      km: Number(s.distance_km).toFixed(4),
      accepted: s.accepted_orders,
      rejected: s.rejected_orders,
      completed: s.completed_orders,
      batched: s.batched_orders,
      late: s.late_deliveries,
      delay: Number(s.total_delay_minutes).toFixed(4),
      overtime: Number(s.overtime_minutes).toFixed(4),
      lat: Number(s.current_lat).toFixed(6),
      lng: Number(s.current_lng).toFixed(6),
    };
  }

  const deliveries = await pool.query(
    `SELECT a.code, o.external_order_number, oa.completed_at_simulation_second, oa.promised_dropoff_second,
            oa.delay_seconds, oa.paid_amount::text
     FROM order_assignments oa JOIN orders o ON o.id = oa.order_id JOIN agents a ON a.id = oa.agent_id
     WHERE o.simulation_id = $1 ORDER BY a.code, o.external_order_number`,
    [simulationId]
  );
  const counts = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM orders WHERE simulation_id = $1) AS orders,
            (SELECT COUNT(*)::int FROM agent_decisions WHERE simulation_id = $1 AND order_id IS NOT NULL) AS decisions`,
    [simulationId]
  );
  return { agents, deliveries: deliveries.rows, counts: counts.rows[0] };
}

test.after(async () => {
  for (const { userId, simulationId } of created) {
    await pool.query("DELETE FROM simulation_sessions WHERE id = $1", [simulationId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  await pool.end();
});

test("el motor persiste estados separados por agente que coinciden con la memoria", async () => {
  const simulation = await createSimulation(42026);
  const engine = await newEngine(simulation);
  await engine.prepare();
  await runUntil(engine, 0, SHIFT_SECONDS);
  await engine.finish();

  const states = await persistence.loadAgentStates(simulation.id);
  assert.equal(states.length, 2);
  assert.notEqual(states[0].id, states[1].id);

  for (const state of states) {
    const memory = engine.core.agents[state.code].counters;
    assert.ok(Math.abs(Number(state.earnings) - memory.grossEarnings) < 0.01, `${state.code} earnings`);
    assert.ok(Math.abs(Number(state.operating_cost) - memory.operatingCost) < 0.01, `${state.code} cost`);
    assert.equal(state.completed_orders, memory.completedOrders);
    assert.equal(state.accepted_orders + state.rejected_orders, engine.core.orders.size);
  }
});

test("reiniciar a mitad del recorrido (y caer a mitad de una transacción) da el mismo estado final", async () => {
  const seed = 1011;

  // A: sin interrupción.
  const simA = await createSimulation(seed);
  const engineA = await newEngine(simA);
  await engineA.prepare();
  await runUntil(engineA, 0, SHIFT_SECONDS);
  await engineA.finish();

  // B: corre hasta que un repartidor va a mitad de un tramo con pedido.
  const simB = await createSimulation(seed);
  const engineB1 = await newEngine(simB);
  await engineB1.prepare();
  let crashSecond = null;
  for (let second = STEP_SECONDS; second <= SHIFT_SECONDS; second += STEP_SECONDS) {
    await engineB1.advance(second);
    const midLeg = Object.values(engineB1.core.agents).some(
      (a) => a.plan?.kind === "DELIVERY" && a.plan.legs.some((leg) => leg.fromSecond < second && second < leg.toSecond)
    );
    if (second > 3600 && midLeg) {
      crashSecond = second;
      break;
    }
  }
  assert.ok(crashSecond, "debe haber un repartidor a mitad de un tramo");

  // El proceso muere en medio del siguiente paso: los efectos ya escritos en
  // esa transacción (pedidos, decisiones, cobros) deben revertirse.
  const originalSave = persistence.saveSnapshot;
  persistence.saveSnapshot = async () => {
    throw new Error("proceso terminado a mitad de la transacción");
  };
  engineB1.dirty = true;
  await assert.rejects(engineB1.advance(crashSecond + 40 * 60));
  persistence.saveSnapshot = originalSave;

  // "Reinicio": un motor nuevo, sin nada en memoria, desde la base de datos.
  const engineB2 = await newEngine(simB);
  assert.equal(await engineB2.restore(), true);
  assert.equal(engineB2.core.clock <= crashSecond, true, "continúa desde el último snapshot confirmado");
  assert.ok(
    Object.values(engineB2.core.agents).some((a) => a.plan?.kind === "DELIVERY"),
    "la ruta activa se recupera"
  );

  const resumeFrom = Math.floor(engineB2.core.clock / STEP_SECONDS) * STEP_SECONDS;
  await runUntil(engineB2, resumeFrom, SHIFT_SECONDS);
  await engineB2.advance(SHIFT_SECONDS);
  await engineB2.finish();

  const a = await finalState(simA.id);
  const b = await finalState(simB.id);
  assert.deepEqual(b.agents, a.agents);
  assert.deepEqual(b.counts, a.counts);
  assert.deepEqual(b.deliveries, a.deliveries);
});
