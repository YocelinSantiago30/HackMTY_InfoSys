const pool = require("../config/database");
const HttpError = require("../utils/httpError");

async function insertOrder(order) {
  const columns = Object.keys(order);
  const values = Object.values(order);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  const result = await pool.query(
    `INSERT INTO orders (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    values
  );

  return result.rows[0];
}

async function countOrders(simulationId) {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM orders WHERE simulation_id = $1",
    [simulationId]
  );

  return result.rows[0].count;
}

async function listOrdersForSimulation(simulationId) {
  const result = await pool.query(
    "SELECT * FROM orders WHERE simulation_id = $1 ORDER BY external_order_number ASC",
    [simulationId]
  );

  return result.rows;
}

async function getOrderWithOwnershipCheck(orderId, userId) {
  const result = await pool.query(
    `SELECT o.* FROM orders o
     JOIN simulation_sessions s ON s.id = o.simulation_id
     WHERE o.id = $1 AND s.user_id = $2`,
    [orderId, userId]
  );

  return result.rows[0] || null;
}

async function getDecisionsForOrder(orderId, userId) {
  const order = await getOrderWithOwnershipCheck(orderId, userId);

  if (!order) {
    throw new HttpError(404, "Pedido no encontrado");
  }

  const result = await pool.query(
    `SELECT
       a.code AS agent_code,
       ad.decision,
       ad.score,
       ad.reasons,
       ad.positive_factors,
       ad.negative_factors,
       ad.restrictions,
       ad.estimated_impact,
       ad.decided_at_simulation_second,
       ad.created_at
     FROM agent_decisions ad
     JOIN agents a ON a.id = ad.agent_id
     WHERE ad.order_id = $1
     ORDER BY a.code`,
    [orderId]
  );

  return { order, decisions: result.rows };
}

module.exports = {
  insertOrder,
  countOrders,
  listOrdersForSimulation,
  getDecisionsForOrder,
};
