const test = require("node:test");
const assert = require("node:assert/strict");
const { computeMetrics } = require("../src/utils/metricsCalculator");

test("calcula las métricas derivadas correctamente", () => {
  const agentState = {
    earnings: 300,
    accepted_orders: 3,
    rejected_orders: 1,
    completed_orders: 3,
    cancelled_orders: 0,
    expired_orders: 0,
    distance_km: 15,
    active_minutes: 30,
    batched_orders: 1,
    repositions: 0,
  };

  const metrics = computeMetrics({ agentState, elapsedMinutes: 60 });

  assert.equal(metrics.totalEarnings, 300);
  assert.equal(metrics.earningsPerMinute, 5); // 300/60
  assert.equal(metrics.earningsPerActiveMinute, 10); // 300/30
  assert.equal(metrics.earningsPerKm, 20); // 300/15
  assert.equal(metrics.averageOrderPayment, 100); // 300/3
  assert.equal(metrics.acceptanceRate, 75); // 3/(3+1)*100
  assert.equal(metrics.completionRate, 100); // 3/3*100
  assert.equal(metrics.idleMinutes, 30); // 60-30
  assert.equal(metrics.efficiencyScore, 50); // 30/60*100
});

test("no revienta con división entre cero (agente sin actividad)", () => {
  const agentState = {
    earnings: 0,
    accepted_orders: 0,
    rejected_orders: 0,
    completed_orders: 0,
    cancelled_orders: 0,
    expired_orders: 0,
    distance_km: 0,
    active_minutes: 0,
    batched_orders: 0,
    repositions: 0,
  };

  const metrics = computeMetrics({ agentState, elapsedMinutes: 0 });

  assert.equal(metrics.earningsPerMinute, 0);
  assert.equal(metrics.acceptanceRate, 0);
  assert.equal(metrics.efficiencyScore, 0);
});

test("efficiencyScore nunca supera 100 aunque active_minutes exceda el tiempo transcurrido", () => {
  // Ver FASE 16: puede pasar sin un motor de movimiento real que limite
  // cuánto trabajo puede "tomar" un agente por segundo transcurrido.
  const agentState = {
    earnings: 100,
    accepted_orders: 1,
    rejected_orders: 0,
    completed_orders: 1,
    cancelled_orders: 0,
    expired_orders: 0,
    distance_km: 5,
    active_minutes: 500,
    batched_orders: 0,
    repositions: 0,
  };

  const metrics = computeMetrics({ agentState, elapsedMinutes: 1 });

  assert.equal(metrics.efficiencyScore, 100);
  assert.equal(metrics.idleMinutes, 0); // Math.max(0, ...) evita negativos
});
