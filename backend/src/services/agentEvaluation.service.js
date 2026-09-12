const crypto = require("crypto");
const pool = require("../config/database");
const logger = require("../utils/logger");
const { evaluateBaseline } = require("../agents/baselineAgent");
const { evaluateSmartCourier } = require("../agents/smartCourierAgent");
const { evaluateReposition } = require("../agents/repositionEvaluator");
const userService = require("./user.service");
const optimizationService = require("./optimization.service");
const socketBus = require("../socket/socketBus");
const { simulatedHourOfDay } = require("../simulation/simulatedTime");
const { SERVICE_AREA_CENTER } = require("../simulation/OrderGenerator");

async function getAgentByCode(code) {
  const result = await pool.query("SELECT id, code FROM agents WHERE code = $1", [code]);
  return result.rows[0];
}

async function getAgentState(simulationId, agentId) {
  const result = await pool.query(
    "SELECT * FROM agent_states WHERE simulation_id = $1 AND agent_id = $2",
    [simulationId, agentId]
  );
  return result.rows[0];
}

async function getOrderById(orderId) {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] || null;
}

async function recordDecision({
  simulationId,
  agentId,
  orderId = null,
  decidedAtSecond,
  decision,
  reasons = [],
  positiveFactors = [],
  negativeFactors = [],
  restrictions = [],
  score = null,
  estimatedImpact = {},
  agentPositionLat = null,
  agentPositionLng = null,
}) {
  await pool.query(
    `INSERT INTO agent_decisions
       (simulation_id, agent_id, order_id, decision, score, reasons, positive_factors, negative_factors, restrictions, estimated_impact, agent_position_lat, agent_position_lng, decided_at_simulation_second)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
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
      agentPositionLat,
      agentPositionLng,
      decidedAtSecond,
    ]
  );
}

async function applyAcceptance({ simulationId, agentId, order }) {
  // No existe todavía un motor de movimiento que simule el trayecto real,
  // así que —solo para efectos económicos— aceptar equivale a completar de
  // inmediato: se acredita el pago y se cuenta como entrega completada en
  // el mismo instante (decisión revisada en la FASE 16, ver resumen de fase).
  await pool.query(
    `INSERT INTO order_assignments
       (order_id, agent_id, original_route_distance_km, assigned_at_simulation_second, completed_at_simulation_second)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (order_id, agent_id) DO NOTHING`,
    [order.id, agentId, order.distance_km, order.created_at_simulation_second]
  );

  const updated = await pool.query(
    `UPDATE agent_states
     SET accepted_orders = accepted_orders + 1,
         completed_orders = completed_orders + 1,
         earnings = earnings + $3,
         distance_km = distance_km + $4,
         active_minutes = active_minutes + $5,
         updated_at = now()
     WHERE simulation_id = $1 AND agent_id = $2
     RETURNING *`,
    [simulationId, agentId, order.final_payment, order.distance_km, order.estimated_time_minutes]
  );

  socketBus.emitToSimulation(simulationId, "metrics_updated", { agentId, agentState: updated.rows[0] });
}

async function applyRejection({ simulationId, agentId }) {
  const updated = await pool.query(
    `UPDATE agent_states
     SET rejected_orders = rejected_orders + 1,
         updated_at = now()
     WHERE simulation_id = $1 AND agent_id = $2
     RETURNING *`,
    [simulationId, agentId]
  );

  socketBus.emitToSimulation(simulationId, "metrics_updated", { agentId, agentState: updated.rows[0] });
}

// Solo lo usa SmartCourier: marca al agente "ocupado" con este pedido hasta
// el segundo estimado de entrega, para que el próximo pedido que llegue
// mientras tanto se evalúe como candidato a batching (FASE 21).
async function markBusy({ simulationId, agentId, orderId, busyUntilSecond }) {
  await pool.query(
    `UPDATE agent_states
     SET active_order_id = $3, busy_until_simulation_second = $4, updated_at = now()
     WHERE simulation_id = $1 AND agent_id = $2`,
    [simulationId, agentId, orderId, busyUntilSecond]
  );
}

async function applyBatch({ simulationId, agentId, activeOrderId, newOrder, impact }) {
  const batchGroupId = crypto.randomUUID();

  await pool.query(
    `UPDATE order_assignments SET batch_group_id = $3
     WHERE order_id = $1 AND agent_id = $2`,
    [activeOrderId, agentId, batchGroupId]
  );

  await pool.query(
    `INSERT INTO order_assignments
       (order_id, agent_id, batch_group_id, original_route_distance_km, batched_route_distance_km,
        additional_distance_km, additional_time_minutes, additional_revenue,
        assigned_at_simulation_second, completed_at_simulation_second)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (order_id, agent_id) DO NOTHING`,
    [
      newOrder.id,
      agentId,
      batchGroupId,
      newOrder.distance_km,
      impact.batchedRouteDistance,
      impact.additionalDistance,
      impact.additionalTime,
      impact.additionalRevenue,
      newOrder.created_at_simulation_second,
    ]
  );

  const updated = await pool.query(
    `UPDATE agent_states
     SET earnings = earnings + $3,
         distance_km = distance_km + $4,
         active_minutes = active_minutes + $5,
         batched_orders = batched_orders + 1,
         accepted_orders = accepted_orders + 1,
         completed_orders = completed_orders + 1,
         busy_until_simulation_second = COALESCE(busy_until_simulation_second, 0) + $6,
         updated_at = now()
     WHERE simulation_id = $1 AND agent_id = $2
     RETURNING *`,
    [
      simulationId,
      agentId,
      impact.additionalRevenue,
      impact.additionalDistance,
      impact.additionalTime,
      Math.round(impact.additionalTime * 60),
    ]
  );

  socketBus.emitToSimulation(simulationId, "metrics_updated", { agentId, agentState: updated.rows[0] });
}

async function evaluateOrderWithBaseline({ simulationId, userId, order }) {
  const agent = await getAgentByCode("BASELINE");

  if (!agent) {
    logger.error("No se encontró el agente BASELINE en el catálogo");
    return null;
  }

  const preferences = await userService.getPreferences(userId);
  const { decision, reasons } = evaluateBaseline({ order, preferences });
  const positiveFactors = reasons.filter((reason) => reason.passed);
  const negativeFactors = reasons.filter((reason) => !reason.passed);

  await recordDecision({
    simulationId,
    agentId: agent.id,
    orderId: order.id,
    decidedAtSecond: order.created_at_simulation_second,
    decision,
    reasons,
    positiveFactors,
    negativeFactors,
  });

  if (decision === "ACCEPT") {
    await applyAcceptance({ simulationId, agentId: agent.id, order });
  } else {
    await applyRejection({ simulationId, agentId: agent.id });
  }

  socketBus.emitToSimulation(simulationId, "baseline_decision", {
    orderId: order.id,
    orderNumber: order.external_order_number,
    decision,
    reasons,
  });

  logger.baseline(
    `Pedido #${order.external_order_number} -> ${decision} ` +
      `(pago/min=${(order.final_payment / order.estimated_time_minutes).toFixed(2)}, ` +
      `pago/km=${(order.final_payment / order.distance_km).toFixed(2)}, ` +
      `distancia=${order.distance_km}km)`
  );

  return { decision, reasons };
}

async function evaluateOrderWithSmartCourier({ simulationId, userId, order, simulation }) {
  const agent = await getAgentByCode("SMARTCOURIER");

  if (!agent) {
    logger.error("No se encontró el agente SMARTCOURIER en el catálogo");
    return null;
  }

  const preferences = await userService.getPreferences(userId);

  const agentState = await getAgentState(simulationId, agent.id);
  let activeOrder = null;
  if (
    agentState?.busy_until_simulation_second &&
    agentState.busy_until_simulation_second > order.created_at_simulation_second &&
    agentState.active_order_id
  ) {
    activeOrder = await getOrderById(agentState.active_order_id);
  }

  let routeOptimization = null;
  if (activeOrder) {
    routeOptimization = await optimizationService.optimizeBatch({
      start: { lat: Number(activeOrder.pickup_lat), lng: Number(activeOrder.pickup_lng) },
      stops: [
        { id: "new_pickup", type: "pickup", order_id: "new", lat: Number(order.pickup_lat), lng: Number(order.pickup_lng) },
        { id: "new_dropoff", type: "dropoff", order_id: "new", lat: Number(order.dropoff_lat), lng: Number(order.dropoff_lng) },
        { id: "active_dropoff", type: "dropoff", order_id: "active", lat: Number(activeOrder.dropoff_lat), lng: Number(activeOrder.dropoff_lng) },
      ],
    });
  }

  const {
    decision,
    score,
    positiveFactors,
    negativeFactors,
    restrictions,
    estimatedImpact,
  } = evaluateSmartCourier({ order, preferences, simulation, activeOrder, routeOptimization });

  await recordDecision({
    simulationId,
    agentId: agent.id,
    orderId: order.id,
    decidedAtSecond: order.created_at_simulation_second,
    decision,
    reasons: [...positiveFactors, ...negativeFactors],
    positiveFactors,
    negativeFactors,
    restrictions,
    score,
    estimatedImpact,
  });

  if (decision === "ACCEPT") {
    await applyAcceptance({ simulationId, agentId: agent.id, order });
    const busyUntilSecond =
      order.created_at_simulation_second + Math.round(order.estimated_time_minutes * 60);
    await markBusy({ simulationId, agentId: agent.id, orderId: order.id, busyUntilSecond });
  } else if (decision === "REJECT") {
    await applyRejection({ simulationId, agentId: agent.id });
  } else if (decision === "BATCH") {
    await applyBatch({
      simulationId,
      agentId: agent.id,
      activeOrderId: activeOrder.id,
      newOrder: order,
      impact: estimatedImpact,
    });
  }
  // WAIT: no modifica agent_states, solo queda registrada la decisión.

  socketBus.emitToSimulation(simulationId, "smart_decision", {
    orderId: order.id,
    orderNumber: order.external_order_number,
    decision,
    score,
    positiveFactors,
    negativeFactors,
    restrictions,
    estimatedImpact,
  });

  logger.smart(
    `Pedido #${order.external_order_number} -> ${decision}` +
      (score !== null ? ` (score=${score})` : "") +
      (restrictions.length ? `, restricciones=${restrictions.map((r) => r.code).join(",")}` : "")
  );

  return { decision, score, positiveFactors, negativeFactors, restrictions, estimatedImpact };
}

// Se llama periódicamente desde SimulationEngine (no en respuesta a un
// pedido) para que SmartCourier evalúe WAIT vs REPOSITION cuando está
// libre (sección 22). Baseline nunca participa de esto (sección 3).
async function evaluateIdleRepositioning({ simulationId, userId, currentSecond }) {
  const agent = await getAgentByCode("SMARTCOURIER");

  if (!agent) {
    logger.error("No se encontró el agente SMARTCOURIER en el catálogo");
    return null;
  }

  const agentState = await getAgentState(simulationId, agent.id);

  if (agentState?.busy_until_simulation_second && agentState.busy_until_simulation_second > currentSecond) {
    return null; // ocupado con un pedido, no evalúa reposicionamiento
  }

  const preferences = await userService.getPreferences(userId);
  const currentLat = agentState?.current_lat ?? SERVICE_AREA_CENTER.lat;
  const currentLng = agentState?.current_lng ?? SERVICE_AREA_CENTER.lng;
  const hour = simulatedHourOfDay(currentSecond);

  const { decision, reasons, impact } = evaluateReposition({
    currentLat: Number(currentLat),
    currentLng: Number(currentLng),
    simulatedHour: hour,
    preferences,
  });

  await recordDecision({
    simulationId,
    agentId: agent.id,
    decidedAtSecond: currentSecond,
    decision,
    reasons,
    estimatedImpact: impact,
    agentPositionLat: currentLat,
    agentPositionLng: currentLng,
  });

  if (decision === "REPOSITION") {
    const updated = await pool.query(
      `UPDATE agent_states
       SET current_lat = $3,
           current_lng = $4,
           repositions = repositions + 1,
           active_minutes = active_minutes + $5,
           updated_at = now()
       WHERE simulation_id = $1 AND agent_id = $2
       RETURNING *`,
      [simulationId, agent.id, impact.toLat, impact.toLng, impact.travelTimeMinutes]
    );

    socketBus.emitToSimulation(simulationId, "metrics_updated", { agentId: agent.id, agentState: updated.rows[0] });
  }

  socketBus.emitToSimulation(simulationId, "smart_decision", {
    orderId: null,
    orderNumber: null,
    decision,
    score: null,
    positiveFactors: [],
    negativeFactors: [],
    restrictions: [],
    estimatedImpact: impact,
  });

  logger.smart(`Reposicionamiento -> ${decision} (${reasons[0]?.message || ""})`);

  return { decision, reasons, impact };
}

module.exports = {
  evaluateOrderWithBaseline,
  evaluateOrderWithSmartCourier,
  evaluateIdleRepositioning,
};
