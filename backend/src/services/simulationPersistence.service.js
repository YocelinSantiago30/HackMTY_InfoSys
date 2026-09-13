// Escrituras a la base de datos que hace el motor de simulación. La lógica
// (qué decide cada agente, cuándo cobra) vive en SimulationCore; aquí solo
// se guarda el resultado. Todas aceptan `db` (pool o cliente de una
// transacción) y son idempotentes: reprocesar un tick no duplica filas,
// pagos ni kilómetros.
const pool = require("../config/database");

async function getAgentIds(db = pool) {
  const result = await db.query("SELECT id, code FROM agents");
  return Object.fromEntries(result.rows.map((row) => [row.code, row.id]));
}

async function loadAgentStates(simulationId, db = pool) {
  const result = await db.query(
    `SELECT a.code, s.* FROM agent_states s JOIN agents a ON a.id = s.agent_id
     WHERE s.simulation_id = $1`,
    [simulationId]
  );
  return result.rows;
}

async function insertOrder(order, db = pool) {
  const columns = Object.keys(order);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await db.query(
    `INSERT INTO orders (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT (simulation_id, external_order_number) DO UPDATE SET simulation_id = EXCLUDED.simulation_id
     RETURNING *`,
    Object.values(order)
  );
  return result.rows[0];
}

async function recordDecision(
  {
    simulationId,
    agentId,
    orderId = null,
    decidedAtSecond,
    decision,
    score = null,
    reasons = [],
    positiveFactors = [],
    negativeFactors = [],
    restrictions = [],
    estimatedImpact = {},
    position = null,
  },
  db = pool
) {
  const values = [
    simulationId,
    agentId,
    orderId,
    decision,
    score,
    JSON.stringify(reasons),
    JSON.stringify(positiveFactors),
    JSON.stringify(negativeFactors),
    JSON.stringify(restrictions),
    JSON.stringify(estimatedImpact),
    position?.lat ?? null,
    position?.lng ?? null,
    Math.round(decidedAtSecond),
  ];
  const insert = `INSERT INTO agent_decisions
       (simulation_id, agent_id, order_id, decision, score, reasons, positive_factors, negative_factors,
        restrictions, estimated_impact, agent_position_lat, agent_position_lng, decided_at_simulation_second)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;

  await db.query(
    orderId
      ? `${insert} ON CONFLICT (simulation_id, agent_id, order_id, decided_at_simulation_second) WHERE order_id IS NOT NULL DO NOTHING`
      : insert,
    values
  );
}

async function upsertAssignment({ orderId, agentId, batchGroupId, distanceKm, assignedAtSecond, promisedSecond }, db = pool) {
  await db.query(
    `INSERT INTO order_assignments
       (order_id, agent_id, batch_group_id, original_route_distance_km, assigned_at_simulation_second, promised_dropoff_second)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id, agent_id) DO UPDATE
       SET batch_group_id = COALESCE(EXCLUDED.batch_group_id, order_assignments.batch_group_id)`,
    [orderId, agentId, batchGroupId, distanceKm, Math.round(assignedAtSecond), promisedSecond]
  );
}

// El cobro queda registrado una sola vez: si la fila ya estaba completada no
// se vuelve a tocar.
async function markAssignmentCompleted({ orderId, agentId, completedAtSecond, delaySeconds, paidAmount }, db = pool) {
  await db.query(
    `UPDATE order_assignments
     SET completed_at_simulation_second = $3, delay_seconds = $4, paid_amount = $5
     WHERE order_id = $1 AND agent_id = $2 AND completed_at_simulation_second IS NULL`,
    [orderId, agentId, Math.round(completedAtSecond), Math.round(delaySeconds), paidAmount]
  );
}

// Espejo exacto de los contadores en memoria: se sobrescriben (no se suman).
async function persistAgentState({ simulationId, agentId, counters, position, busyUntilSecond, activeOrderId }, db = pool) {
  const result = await db.query(
    `UPDATE agent_states
     SET earnings = $3, operating_cost = $4, distance_km = $5, active_minutes = $6,
         accepted_orders = $7, rejected_orders = $8, completed_orders = $9, cancelled_orders = $10,
         batched_orders = $11, repositions = $12, current_lat = $13, current_lng = $14,
         busy_until_simulation_second = $15, active_order_id = $16,
         late_deliveries = $17, total_delay_minutes = $18, total_eta_error_minutes = $19, overtime_minutes = $20,
         updated_at = now()
     WHERE simulation_id = $1 AND agent_id = $2
     RETURNING *`,
    [
      simulationId,
      agentId,
      counters.grossEarnings,
      counters.operatingCost,
      counters.distanceKm,
      counters.activeMinutes,
      counters.acceptedOrders,
      counters.rejectedOrders,
      counters.completedOrders,
      counters.cancelledOrders,
      counters.batchedOrders,
      counters.repositions,
      position.lat,
      position.lng,
      busyUntilSecond === null ? null : Math.round(busyUntilSecond),
      activeOrderId,
      counters.lateDeliveries,
      counters.totalDelayMinutes,
      counters.totalEtaErrorMinutes,
      counters.overtimeMinutes,
    ]
  );
  return result.rows[0];
}

async function saveRuntime({ simulationId, simulationOrders, snapshot }, db = pool) {
  await db.query(
    `INSERT INTO simulation_runtime (simulation_id, simulation_orders, snapshot, snapshot_second)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (simulation_id) DO UPDATE
       SET simulation_orders = EXCLUDED.simulation_orders, snapshot = EXCLUDED.snapshot,
           snapshot_second = EXCLUDED.snapshot_second, updated_at = now()`,
    [simulationId, JSON.stringify(simulationOrders), JSON.stringify(snapshot), Math.round(snapshot.clock)]
  );
}

async function saveSnapshot({ simulationId, snapshot }, db = pool) {
  await db.query(
    `UPDATE simulation_runtime SET snapshot = $2, snapshot_second = $3, updated_at = now()
     WHERE simulation_id = $1`,
    [simulationId, JSON.stringify(snapshot), Math.round(snapshot.clock)]
  );
}

async function loadRuntime(simulationId, db = pool) {
  const result = await db.query(
    "SELECT simulation_orders, snapshot FROM simulation_runtime WHERE simulation_id = $1",
    [simulationId]
  );
  return result.rows[0] || null;
}

module.exports = {
  getAgentIds,
  loadAgentStates,
  insertOrder,
  recordDecision,
  upsertAssignment,
  markAssignmentCompleted,
  persistAgentState,
  saveRuntime,
  saveSnapshot,
  loadRuntime,
};
