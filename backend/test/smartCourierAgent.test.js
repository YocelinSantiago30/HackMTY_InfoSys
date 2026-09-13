const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateSmartCourier, DEFAULT_THRESHOLDS } = require("../src/agents/smartCourierAgent");

function baseOrder(overrides = {}) {
  return {
    final_payment: 150,
    distance_km: 3,
    estimated_time_minutes: 8,
    destination_demand: "VERY_HIGH",
    package_weight: 1,
    pickup_lat: 25.69,
    pickup_lng: -100.31,
    created_at_simulation_second: 0,
    ...overrides,
  };
}

function metrics(overrides = {}) {
  const m = {
    distanceToPickupKm: 1,
    deliveryDistanceKm: 3,
    totalKm: 4,
    totalMinutes: 20,
    operatingCost: 8,
    grossPayment: 150,
    ...overrides,
  };
  m.netProfit = overrides.netProfit ?? m.grossPayment - m.operatingCost;
  m.profitPerMinute = overrides.profitPerMinute ?? m.netProfit / m.totalMinutes;
  m.profitPerKm = overrides.profitPerKm ?? m.netProfit / m.totalKm;
  return m;
}

test("ACCEPT para un pedido rentable, cercano y rápido", () => {
  const { decision, score } = evaluateSmartCourier({ order: baseOrder(), metrics: metrics() });

  assert.equal(decision, "ACCEPT");
  assert.ok(score >= DEFAULT_THRESHOLDS.accept);
});

test("el mismo pago con un pickup lejano baja el score: el trayecto vacío cuenta", () => {
  const near = evaluateSmartCourier({ order: baseOrder({ final_payment: 60 }), metrics: metrics({ grossPayment: 60 }) });
  const far = evaluateSmartCourier({
    order: baseOrder({ final_payment: 60 }),
    metrics: metrics({ grossPayment: 60, distanceToPickupKm: 12, totalKm: 15, operatingCost: 30, totalMinutes: 55 }),
  });

  assert.ok(far.score < near.score);
  assert.notEqual(far.decision, "ACCEPT");
});

test("REJECT con NEGATIVE_PROFIT cuando el costo operativo supera el pago", () => {
  const { decision, restrictions } = evaluateSmartCourier({
    order: baseOrder({ final_payment: 20 }),
    metrics: metrics({ grossPayment: 20, totalKm: 15, operatingCost: 30 }),
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "NEGATIVE_PROFIT"));
});

test("restricción dura vence a un score alto (sección 6)", () => {
  const { decision, score, restrictions } = evaluateSmartCourier({
    order: baseOrder({ package_weight: 20 }),
    metrics: metrics(),
    preferences: { bag_max_weight: 5 },
  });

  assert.equal(decision, "REJECT");
  assert.ok(score >= DEFAULT_THRESHOLDS.accept, "el score seguía siendo bueno, pero la restricción debe vetar");
  assert.equal(restrictions[0].code, "BAG_CAPACITY_EXCEEDED");
});

test("restricción por límite de distancia nocturna", () => {
  const { decision, restrictions } = evaluateSmartCourier({
    order: baseOrder({ distance_km: 20, created_at_simulation_second: 36000 }), // ~22:00 simulado
    metrics: metrics(),
    preferences: { night_distance_limit_km: 10 },
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "NIGHT_DISTANCE_LIMIT_EXCEEDED"));
});

test("restricción por zona de trabajo configurada", () => {
  const { decision, restrictions } = evaluateSmartCourier({
    order: baseOrder({ pickup_lat: 19.4326, pickup_lng: -99.1332 }), // CDMX
    metrics: metrics(),
    preferences: { work_zone_center_lat: 25.6866, work_zone_center_lng: -100.3161, work_zone_radius_km: 10 },
  });

  assert.equal(decision, "REJECT");
  assert.ok(restrictions.some((r) => r.code === "OUTSIDE_WORK_ZONE"));
});

test("banda intermedia se mapea a WAIT", () => {
  const { decision, score } = evaluateSmartCourier({
    order: baseOrder({ destination_demand: "MEDIUM" }),
    metrics: metrics({ grossPayment: 70, distanceToPickupKm: 5, totalKm: 10, operatingCost: 20, totalMinutes: 40 }),
  });

  assert.equal(decision, "WAIT", `score=${score}`);
  assert.ok(score >= DEFAULT_THRESHOLDS.wait && score < DEFAULT_THRESHOLDS.accept);
});

test("los strings numéricos de Postgres no alteran el cálculo", () => {
  const asNumbers = evaluateSmartCourier({ order: baseOrder(), metrics: metrics() });
  const asStrings = evaluateSmartCourier({
    order: baseOrder({ final_payment: "150", package_weight: "1", pickup_lat: "25.69", pickup_lng: "-100.31" }),
    metrics: metrics(),
    preferences: { bag_max_weight: "5" },
  });

  assert.equal(asStrings.score, asNumbers.score);
  assert.equal(asStrings.decision, asNumbers.decision);
});
