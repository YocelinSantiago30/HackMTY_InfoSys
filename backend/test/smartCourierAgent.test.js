const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateSmartCourier,
  ACCEPT_THRESHOLD,
  WAIT_THRESHOLD,
} = require("../src/agents/smartCourierAgent");

function baseOrder(overrides = {}) {
  return {
    final_payment: 150,
    distance_km: 3,
    estimated_time_minutes: 8,
    estimated_preparation_minutes: 5,
    traffic_level: "LOW",
    destination_demand: "VERY_HIGH",
    surge_multiplier: 1.8,
    package_weight: 1,
    pickup_lat: 25.69,
    pickup_lng: -100.31,
    dropoff_lat: 25.7,
    dropoff_lng: -100.3,
    created_at_simulation_second: 0,
    route_source: "ROUTED",
    ...overrides,
  };
}

test("ACCEPT para un pedido excelente (score >= umbral)", () => {
  const { decision, score } = evaluateSmartCourier({ order: baseOrder(), preferences: {} });

  assert.equal(decision, "ACCEPT");
  assert.ok(score >= ACCEPT_THRESHOLD);
});

test("REJECT para un pedido malo (score bajo, sin restricciones)", () => {
  const order = baseOrder({
    final_payment: 30,
    distance_km: 14,
    estimated_time_minutes: 35,
    estimated_preparation_minutes: 20,
    traffic_level: "SEVERE",
    destination_demand: "LOW",
    surge_multiplier: 1.0,
  });
  const { decision, score, restrictions } = evaluateSmartCourier({ order, preferences: {} });

  assert.equal(decision, "REJECT");
  assert.ok(score < WAIT_THRESHOLD);
  assert.equal(restrictions.length, 0);
});

test("restricción dura vence a un score alto (sección 6)", () => {
  // Mismo pedido excelente del primer test, pero excede la capacidad de la mochila
  const order = baseOrder({ package_weight: 20 });
  const { decision, score, restrictions } = evaluateSmartCourier({
    order,
    preferences: { bag_max_weight: 5 },
  });

  assert.equal(decision, "REJECT");
  assert.ok(score >= WAIT_THRESHOLD, "el score seguía siendo bueno, pero la restricción debe vetar");
  assert.equal(restrictions[0].code, "BAG_CAPACITY_EXCEEDED");
});

test("restricción por límite de distancia nocturna", () => {
  const order = baseOrder({
    distance_km: 20,
    created_at_simulation_second: 36000, // hora simulada ~22:00
  });
  const { decision, restrictions } = evaluateSmartCourier({
    order,
    preferences: { night_distance_limit_km: 10 },
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "NIGHT_DISTANCE_LIMIT_EXCEEDED"));
});

test("restricción por zona de trabajo configurada", () => {
  const order = baseOrder({ pickup_lat: 19.4326, pickup_lng: -99.1332 }); // CDMX
  const { decision, restrictions } = evaluateSmartCourier({
    order,
    preferences: {
      work_zone_center_lat: 25.6866,
      work_zone_center_lng: -100.3161,
      work_zone_radius_km: 10,
    },
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "OUTSIDE_WORK_ZONE"));
});

test("banda EVALUATE (50-69) se mapea a WAIT", () => {
  // Mismos valores usados en producción para confirmar la banda intermedia
  const order = baseOrder({
    final_payment: 200,
    distance_km: 20,
    estimated_time_minutes: 25,
    estimated_preparation_minutes: 10,
    traffic_level: "LOW",
    destination_demand: "HIGH",
    surge_multiplier: 1.0,
    package_weight: 2,
    created_at_simulation_second: 0,
  });
  const { decision, score } = evaluateSmartCourier({ order, preferences: {} });

  assert.equal(decision, "WAIT");
  assert.ok(score >= WAIT_THRESHOLD && score < ACCEPT_THRESHOLD);
});

test("BATCH cuando hay un pedido activo compatible", () => {
  const activeOrder = {
    id: "active-1",
    pickup_lat: 25.69,
    pickup_lng: -100.31,
    dropoff_lat: 25.705,
    dropoff_lng: -100.295,
    distance_km: 3,
    package_weight: 1,
  };
  const newOrder = baseOrder({
    pickup_lat: 25.691,
    pickup_lng: -100.309,
    dropoff_lat: 25.706,
    dropoff_lng: -100.294,
    package_weight: 0.5,
    distance_km: 2,
  });

  const { decision, estimatedImpact } = evaluateSmartCourier({
    order: newOrder,
    preferences: {},
    activeOrder,
  });

  assert.equal(decision, "BATCH");
  assert.equal(estimatedImpact.additionalRevenue, newOrder.final_payment);
});

test("REJECT con AGENT_BUSY cuando el pedido activo no es compatible para agrupar", () => {
  const activeOrder = {
    id: "active-1",
    pickup_lat: 25.69,
    pickup_lng: -100.31,
    dropoff_lat: 25.705,
    dropoff_lng: -100.295,
    distance_km: 3,
    package_weight: 1,
  };
  const farOrder = baseOrder({ pickup_lat: 25.9, pickup_lng: -100.5, dropoff_lat: 25.95, dropoff_lng: -100.55 });

  const { decision, restrictions } = evaluateSmartCourier({
    order: farOrder,
    preferences: {},
    activeOrder,
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "AGENT_BUSY"));
});
