const pool = require("../config/database");

const VALID_EVENT_TYPES = [
  "SURGE_STARTED",
  "SURGE_ENDED",
  "TRAFFIC_INCREASED",
  "TRAFFIC_DECREASED",
  "ROAD_CLOSED",
  "ROAD_REOPENED",
  "ORDER_CANCELLED",
  "HIGH_DEMAND",
  "LOW_DEMAND",
  "URGENT_ORDER",
];

async function recordEvent({ simulationId, eventType, payload = {}, currentSecond }) {
  const result = await pool.query(
    `INSERT INTO simulation_events (simulation_id, event_type, payload, occurred_at_simulation_second)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [simulationId, eventType, JSON.stringify(payload), currentSecond]
  );

  return result.rows[0];
}

module.exports = {
  VALID_EVENT_TYPES,
  recordEvent,
};
