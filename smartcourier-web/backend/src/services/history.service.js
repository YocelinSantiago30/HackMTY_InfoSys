const pool = require("../config/database");

const VALID_AGENT_CODES = ["BASELINE", "SMARTCOURIER"];
const VALID_DECISIONS = ["ACCEPT", "REJECT", "BATCH", "WAIT", "REPOSITION", "REROUTE"];

async function getHistory(userId, { agent, decision, simulationId, limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const conditions = ["s.user_id = $1"];
  const params = [userId];

  if (agent && VALID_AGENT_CODES.includes(agent)) {
    params.push(agent);
    conditions.push(`a.code = $${params.length}`);
  }

  if (decision && VALID_DECISIONS.includes(decision)) {
    params.push(decision);
    conditions.push(`ad.decision = $${params.length}`);
  }

  if (simulationId) {
    params.push(simulationId);
    conditions.push(`ad.simulation_id = $${params.length}`);
  }

  params.push(safeLimit);
  const limitParamIndex = params.length;
  params.push(safeOffset);
  const offsetParamIndex = params.length;

  const result = await pool.query(
    `SELECT
       ad.id,
       ad.simulation_id,
       a.code AS agent_code,
       o.id AS order_id,
       o.external_order_number,
       o.merchant_name,
       o.final_payment,
       o.distance_km,
       o.estimated_time_minutes,
       ad.decision,
       ad.score,
       ad.reasons,
       ad.positive_factors,
       ad.negative_factors,
       ad.restrictions,
       ad.decided_at_simulation_second,
       ad.created_at
     FROM agent_decisions ad
     JOIN agents a ON a.id = ad.agent_id
     JOIN orders o ON o.id = ad.order_id
     JOIN simulation_sessions s ON s.id = ad.simulation_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ad.created_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params
  );

  return {
    records: result.rows,
    hasMore: result.rows.length === safeLimit,
  };
}

module.exports = {
  getHistory,
};
