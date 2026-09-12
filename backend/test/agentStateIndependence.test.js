// Sección 58 (prueba crítica): "SmartCourier state → independiente de
// Baseline state". Esto vive en la base de datos (filas separadas en
// agent_states), así que se prueba con Postgres real, no con funciones
// puras. Crea su propia simulación de prueba y se limpia sola al terminar.
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/config/database");
const orderService = require("../src/services/order.service");
const agentEvaluationService = require("../src/services/agentEvaluation.service");

async function createTestSimulation() {
  const user = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ('Test Runner', $1, 'x')
     RETURNING id`,
    [`test-${Date.now()}@example.com`]
  );
  const userId = user.rows[0].id;

  const simulation = await pool.query(
    `INSERT INTO simulation_sessions (user_id, seed, mode, simulation_duration_seconds, status)
     VALUES ($1, 1, 'CUSTOM', 3600, 'RUNNING')
     RETURNING *`,
    [userId]
  );

  const agents = await pool.query("SELECT id, code FROM agents");
  for (const agent of agents.rows) {
    await pool.query("INSERT INTO agent_states (simulation_id, agent_id) VALUES ($1, $2)", [
      simulation.rows[0].id,
      agent.id,
    ]);
  }

  return { userId, simulationId: simulation.rows[0].id };
}

async function cleanupTestSimulation(userId, simulationId) {
  await pool.query("DELETE FROM simulation_sessions WHERE id = $1", [simulationId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

async function getAgentState(simulationId, code) {
  const result = await pool.query(
    `SELECT s.* FROM agent_states s JOIN agents a ON a.id = s.agent_id
     WHERE s.simulation_id = $1 AND a.code = $2`,
    [simulationId, code]
  );
  return result.rows[0];
}

test("SmartCourier y Baseline mantienen estados independientes ante el mismo pedido", async () => {
  const { userId, simulationId } = await createTestSimulation();

  try {
    // Pedido barato que Baseline rechaza (bajo pago/km) pero deliberadamente
    // sin restricciones duras ni score suficiente para SmartCourier tampoco
    // — lo importante aquí no es CUÁL decisión toma cada uno, sino que sus
    // efectos en agent_states nunca se mezclan entre sí.
    const order = await orderService.insertOrder({
      simulation_id: simulationId,
      external_order_number: 1,
      merchant_name: "Test",
      pickup_lat: 25.69,
      pickup_lng: -100.31,
      dropoff_lat: 25.7,
      dropoff_lng: -100.3,
      base_payment: 150,
      surge_multiplier: 1.5,
      final_payment: 225,
      distance_km: 3,
      estimated_time_minutes: 8,
      route_source: "ROUTED",
      traffic_level: "LOW",
      destination_demand: "VERY_HIGH",
      priority: "NORMAL",
      package_size: "SMALL",
      package_weight: 1,
      estimated_preparation_minutes: 5,
      expiration_seconds: 120,
      created_at_simulation_second: 0,
    });

    const baselineResult = await agentEvaluationService.evaluateOrderWithBaseline({
      simulationId,
      userId,
      order,
    });

    const smartResult = await agentEvaluationService.evaluateOrderWithSmartCourier({
      simulationId,
      userId,
      order,
      simulation: { simulation_duration_seconds: 3600 },
    });

    // Con estos números, ambos agentes deberían aceptar (score alto,
    // criterios de baseline superados) — lo confirmamos porque si esto
    // cambiara silenciosamente, el resto de la aserción perdería sentido.
    assert.equal(baselineResult.decision, "ACCEPT");
    assert.equal(smartResult.decision, "ACCEPT");

    const baselineState = await getAgentState(simulationId, "BASELINE");
    const smartState = await getAgentState(simulationId, "SMARTCOURIER");

    // Cada agente acumuló SU PROPIA aceptación, no una compartida
    assert.equal(baselineState.accepted_orders, 1);
    assert.equal(smartState.accepted_orders, 1);
    assert.equal(Number(baselineState.earnings), 225);
    assert.equal(Number(smartState.earnings), 225);

    // Las filas son físicamente distintas
    assert.notEqual(baselineState.id, smartState.id);

    // Rechazar con Baseline en un segundo pedido no debe tocar a SmartCourier
    const badOrder = await orderService.insertOrder({
      simulation_id: simulationId,
      external_order_number: 2,
      merchant_name: "Test 2",
      pickup_lat: 25.69,
      pickup_lng: -100.31,
      dropoff_lat: 25.7,
      dropoff_lng: -100.3,
      base_payment: 5,
      surge_multiplier: 1.0,
      final_payment: 5,
      distance_km: 3,
      estimated_time_minutes: 30,
      route_source: "ROUTED",
      traffic_level: "SEVERE",
      destination_demand: "LOW",
      priority: "NORMAL",
      package_size: "SMALL",
      package_weight: 1,
      estimated_preparation_minutes: 5,
      expiration_seconds: 120,
      created_at_simulation_second: 60,
    });

    await agentEvaluationService.evaluateOrderWithBaseline({ simulationId, userId, order: badOrder });

    const baselineStateAfter = await getAgentState(simulationId, "BASELINE");
    const smartStateAfter = await getAgentState(simulationId, "SMARTCOURIER");

    assert.equal(baselineStateAfter.rejected_orders, 1);
    assert.equal(smartStateAfter.rejected_orders, 0); // no evaluó este pedido, no debe cambiar
    assert.equal(Number(smartStateAfter.earnings), 225); // sin cambios respecto a antes
  } finally {
    await cleanupTestSimulation(userId, simulationId);
    await pool.end();
  }
});
