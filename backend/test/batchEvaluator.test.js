const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateBatch } = require("../src/agents/batchEvaluator");

// Coordenadas y distancia geométricamente consistentes entre sí (verificado
// con haversineDistanceKm x STREET_FACTOR) — usar un distance_km inventado
// que no corresponda a las coordenadas reales produce additionalDistance
// negativo sin sentido (bug de fixture ya encontrado dos veces: FASE 21 y
// aquí mismo al escribir esta prueba).
const ACTIVE_ORDER = {
  pickup_lat: 25.6866,
  pickup_lng: -100.3161,
  dropoff_lat: 25.735,
  dropoff_lng: -100.28,
  distance_km: 8.43,
  package_weight: 1,
};

function newOrder(overrides = {}) {
  return {
    pickup_lat: 25.689,
    pickup_lng: -100.313,
    dropoff_lat: 25.738,
    dropoff_lng: -100.284,
    distance_km: 7.59,
    package_weight: 0.5,
    final_payment: 60,
    created_at_simulation_second: 60,
    ...overrides,
  };
}

test("compatible cuando pickup y dropoff están cerca", () => {
  const result = evaluateBatch({ activeOrder: ACTIVE_ORDER, newOrder: newOrder(), preferences: {} });

  assert.equal(result.compatible, true);
  assert.equal(result.restrictions.length, 0);
  assert.equal(result.impact.additionalRevenue, 60);
  assert.ok(result.impact.additionalDistance > 0, "el desvío debe ser positivo con datos consistentes");
});

test("incompatible cuando el pickup está demasiado lejos", () => {
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder({ pickup_lat: 25.9, pickup_lng: -100.5 }),
    preferences: {},
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "PICKUP_TOO_FAR"));
});

test("incompatible cuando el dropoff está demasiado lejos", () => {
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder({ dropoff_lat: 25.95, dropoff_lng: -100.55 }),
    preferences: {},
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "DROPOFF_TOO_FAR"));
});

test("incompatible cuando el peso combinado excede la mochila", () => {
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder({ package_weight: 10 }),
    preferences: { bag_max_weight: 5 },
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "COMBINED_WEIGHT_EXCEEDED"));
});

test("incompatible cuando no queda tiempo suficiente de turno para el desvío", () => {
  // El escenario base agrega ~0.88 min (~53s) de desvío; con solo 10s
  // restantes de turno, no alcanza.
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder({ created_at_simulation_second: 3590 }),
    preferences: {},
    simulation: { simulation_duration_seconds: 3600 },
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "INSUFFICIENT_SHIFT_TIME_FOR_BATCH"));
});

test("usa el resultado de OR-Tools cuando está disponible, en vez de la heurística fija", () => {
  const routeOptimization = { success: true, order: ["a", "b", "c"], totalDistanceKm: 12.5 };
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder(),
    preferences: {},
    routeOptimization,
  });

  assert.equal(result.impact.routeSource, "OPTIMIZED");
  assert.equal(result.impact.batchedRouteDistance, 12.5);
});

test("cae a la heurística fija cuando no hay optimización disponible", () => {
  const result = evaluateBatch({
    activeOrder: ACTIVE_ORDER,
    newOrder: newOrder(),
    preferences: {},
    routeOptimization: { success: false },
  });

  assert.equal(result.impact.routeSource, "HEURISTIC");
});
