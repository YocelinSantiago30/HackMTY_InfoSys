const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateBatch, DEFAULT_BATCH_LIMITS } = require("../src/agents/batchEvaluator");

const ACTIVE = { external_order_number: 1, package_weight: 1, final_payment: 80 };

function newOrder(overrides = {}) {
  return { external_order_number: 2, package_weight: 0.5, final_payment: 70, ...overrides };
}

// El pedido 1 prometió llegar al segundo 1800.
function scenario({ extraKm = 2, extraMinutes = 10, order1ArrivalSecond = 1800 + 5 * 60 } = {}) {
  return {
    promises: { 1: 1800 },
    current: { endSecond: 1800, remainingKm: 6, dropoffSeconds: { 1: 1800 } },
    candidate: {
      endSecond: 1800 + extraMinutes * 60,
      remainingKm: 6 + extraKm,
      dropoffSeconds: { 1: order1ArrivalSecond, 2: 1800 + extraMinutes * 60 },
    },
  };
}

test("compatible cuando el desvío es corto, rentable y respeta la promesa", () => {
  const result = evaluateBatch({ newOrder: newOrder(), activeOrders: [ACTIVE], costPerKm: 2, ...scenario() });

  assert.equal(result.compatible, true);
  assert.equal(result.impact.additionalCost, 4); // 2 km × $2
  assert.equal(result.impact.additionalNetProfit, 66);
  assert.equal(result.impact.maxLateMinutesVsPromise, 5);
  assert.equal(result.impact.promisedDropoffSecond, 2400);
});

test("el retraso se mide contra la hora comprometida, no contra la ruta recalculada", () => {
  // La ruta actual YA viene 8 min tarde por tráfico; agrupar suma 3 min más.
  // Contra la ruta recalculada serían solo 3 min, contra la promesa son 11.
  const s = scenario({ order1ArrivalSecond: 1800 + 11 * 60 });
  s.current.dropoffSeconds[1] = 1800 + 8 * 60;

  const result = evaluateBatch({ newOrder: newOrder(), activeOrders: [ACTIVE], costPerKm: 2, ...s });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "BATCH_BREAKS_PROMISE"));
  assert.ok(result.impact.maxLateMinutesVsPromise > DEFAULT_BATCH_LIMITS.promiseToleranceMinutes);
});

test("sin secuencia factible (ventanas de tiempo) el batch se rechaza", () => {
  const result = evaluateBatch({ newOrder: newOrder(), activeOrders: [ACTIVE], costPerKm: 2, ...scenario(), candidate: null });

  assert.equal(result.compatible, false);
  assert.equal(result.restrictions[0].code, "BATCH_BREAKS_PROMISE");
});

test("incompatible si el tiempo extra se paga peor que el mínimo marginal", () => {
  const result = evaluateBatch({
    newOrder: newOrder({ final_payment: 30 }),
    activeOrders: [ACTIVE],
    costPerKm: 2,
    ...scenario({ extraKm: 4, extraMinutes: 18 }),
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "BATCH_NOT_PROFITABLE"));
});

test("incompatible si el desvío es largo aunque pague bien (no es un batch, es otra entrega)", () => {
  const result = evaluateBatch({
    newOrder: newOrder({ final_payment: 300 }),
    activeOrders: [ACTIVE],
    costPerKm: 2,
    ...scenario({ extraKm: 15, extraMinutes: 70 }),
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "BATCH_DETOUR_TOO_LONG"));
});

test("incompatible cuando el peso combinado excede la mochila", () => {
  const result = evaluateBatch({
    newOrder: newOrder({ package_weight: 6 }),
    activeOrders: [ACTIVE],
    costPerKm: 2,
    preferences: { bag_max_weight: "5" },
    ...scenario(),
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "COMBINED_WEIGHT_EXCEEDED"));
});

test("no agrupa más de dos pedidos en ruta", () => {
  const result = evaluateBatch({
    newOrder: newOrder({ external_order_number: 3 }),
    activeOrders: [ACTIVE, { ...ACTIVE, external_order_number: 2 }],
    costPerKm: 2,
    ...scenario(),
  });

  assert.equal(result.compatible, false);
  assert.ok(result.restrictions.some((r) => r.code === "MAX_ORDERS_IN_ROUTE"));
});
