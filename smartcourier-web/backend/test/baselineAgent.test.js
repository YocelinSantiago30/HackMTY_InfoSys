const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateBaseline, DEFAULTS } = require("../src/agents/baselineAgent");

const GOOD_ORDER = {
  final_payment: 100,
  estimated_time_minutes: 10, // $10/min
  distance_km: 5, // $20/km
};

test("acepta cuando todos los criterios pasan (usando defaults)", () => {
  const { decision, reasons } = evaluateBaseline({ order: GOOD_ORDER, preferences: {} });

  assert.equal(decision, "ACCEPT");
  assert.ok(reasons.every((r) => r.passed));
  assert.equal(reasons.length, 4);
});

test("rechaza por pago/minuto insuficiente", () => {
  const order = { final_payment: 20, estimated_time_minutes: 10, distance_km: 2 }; // $2/min < default $3/min
  const { decision, reasons } = evaluateBaseline({ order, preferences: {} });

  assert.equal(decision, "REJECT");
  const perMinute = reasons.find((r) => r.criterion === "paymentPerMinute");
  assert.equal(perMinute.passed, false);
});

test("rechaza por distancia excesiva, sin afectar otros criterios", () => {
  const order = { final_payment: 200, estimated_time_minutes: 10, distance_km: 20 };
  const { decision, reasons } = evaluateBaseline({
    order,
    preferences: { maximum_distance_km: 15 },
  });

  assert.equal(decision, "REJECT");
  const failed = reasons.filter((r) => !r.passed);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].criterion, "distanceKm");
});

test("respeta preferencias configuradas por el usuario en vez de los defaults", () => {
  const order = { final_payment: 100, estimated_time_minutes: 10, distance_km: 5 }; // $10/min, $20/km
  const { decision } = evaluateBaseline({
    order,
    preferences: { minimum_payment_per_minute: 50 }, // muy por encima de lo que paga el pedido
  });

  assert.equal(decision, "REJECT");
});

test("usa los DEFAULTS documentados cuando no hay preferencias", () => {
  const order = {
    final_payment: DEFAULTS.minimumPaymentPerMinute * 10, // exactamente en el límite por minuto
    estimated_time_minutes: 10,
    distance_km: 1,
  };
  const { reasons } = evaluateBaseline({ order, preferences: {} });
  const perMinute = reasons.find((r) => r.criterion === "paymentPerMinute");

  assert.equal(perMinute.threshold, DEFAULTS.minimumPaymentPerMinute);
  assert.equal(perMinute.passed, true); // ">=" en el límite exacto debe pasar
});
