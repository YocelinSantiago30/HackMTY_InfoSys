const pool = require("../config/database");
const { computeMetrics } = require("../utils/metricsCalculator");

async function getAgentStates(simulationId) {
  const result = await pool.query(
    `SELECT a.code, s.*
     FROM agent_states s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.simulation_id = $1`,
    [simulationId]
  );

  return result.rows;
}

function buildEarningsComparison(baselineMetrics, smartMetrics) {
  const absoluteDifference = Number(
    (smartMetrics.totalEarnings - baselineMetrics.totalEarnings).toFixed(2)
  );

  const percentageImprovement =
    baselineMetrics.totalEarnings > 0
      ? Number(((absoluteDifference / baselineMetrics.totalEarnings) * 100).toFixed(2))
      : null;

  return {
    baseline: baselineMetrics.totalEarnings,
    smartcourier: smartMetrics.totalEarnings,
    absoluteDifference,
    percentageImprovement,
  };
}

async function getComparison(simulationId, elapsedMinutes) {
  const states = await getAgentStates(simulationId);

  const agents = {};
  for (const state of states) {
    agents[state.code] = computeMetrics({ agentState: state, elapsedMinutes });
  }

  const comparison =
    agents.BASELINE && agents.SMARTCOURIER
      ? { totalEarnings: buildEarningsComparison(agents.BASELINE, agents.SMARTCOURIER) }
      : null;

  return { agents, comparison };
}

async function snapshotMetrics(simulationId, elapsedMinutes) {
  const states = await getAgentStates(simulationId);

  for (const state of states) {
    const m = computeMetrics({ agentState: state, elapsedMinutes });

    await pool.query(
      `INSERT INTO agent_metrics (
         simulation_id, agent_id, total_earnings, accepted_orders, rejected_orders, completed_orders,
         cancelled_orders, expired_orders, distance_km, active_minutes, idle_minutes, total_minutes,
         earnings_per_minute, earnings_per_active_minute, earnings_per_km, average_order_payment,
         acceptance_rate, completion_rate, average_delivery_time_minutes, batched_orders, repositions,
         efficiency_score
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (simulation_id, agent_id) DO UPDATE SET
         total_earnings = EXCLUDED.total_earnings,
         accepted_orders = EXCLUDED.accepted_orders,
         rejected_orders = EXCLUDED.rejected_orders,
         completed_orders = EXCLUDED.completed_orders,
         cancelled_orders = EXCLUDED.cancelled_orders,
         expired_orders = EXCLUDED.expired_orders,
         distance_km = EXCLUDED.distance_km,
         active_minutes = EXCLUDED.active_minutes,
         idle_minutes = EXCLUDED.idle_minutes,
         total_minutes = EXCLUDED.total_minutes,
         earnings_per_minute = EXCLUDED.earnings_per_minute,
         earnings_per_active_minute = EXCLUDED.earnings_per_active_minute,
         earnings_per_km = EXCLUDED.earnings_per_km,
         average_order_payment = EXCLUDED.average_order_payment,
         acceptance_rate = EXCLUDED.acceptance_rate,
         completion_rate = EXCLUDED.completion_rate,
         average_delivery_time_minutes = EXCLUDED.average_delivery_time_minutes,
         batched_orders = EXCLUDED.batched_orders,
         repositions = EXCLUDED.repositions,
         efficiency_score = EXCLUDED.efficiency_score,
         computed_at = now()`,
      [
        simulationId,
        state.agent_id,
        m.totalEarnings,
        m.acceptedOrders,
        m.rejectedOrders,
        m.completedOrders,
        m.cancelledOrders,
        m.expiredOrders,
        m.distanceKm,
        m.activeMinutes,
        m.idleMinutes,
        m.totalMinutes,
        m.earningsPerMinute,
        m.earningsPerActiveMinute,
        m.earningsPerKm,
        m.averageOrderPayment,
        m.acceptanceRate,
        m.completionRate,
        m.averageDeliveryTime,
        m.batchedOrders,
        m.repositions,
        m.efficiencyScore,
      ]
    );
  }
}

module.exports = {
  getComparison,
  snapshotMetrics,
};
