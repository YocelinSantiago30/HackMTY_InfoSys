// Garantías de la comparación justa, los recorridos y la recuperación, sin red ni BD.
const test = require("node:test");
const assert = require("node:assert/strict");
const SimulationCore = require("../src/simulation/SimulationCore");
const { estimateRoute } = require("../src/services/routing.service");
const { compareAcceptVsWait } = require("../src/agents/lookaheadPlanner");

const SHIFT_SECONDS = 3 * 60 * 60;
const getRoute = async (params) => estimateRoute(params);

function createCore(seed, options = {}) {
  return new SimulationCore({ simulationId: "test", seed, durationSeconds: SHIFT_SECONDS, getRoute, ...options });
}

async function runFullShift(core, stepSeconds) {
  await core.prepare();
  for (let second = stepSeconds; second < SHIFT_SECONDS; second += stepSeconds) {
    await core.advanceTo(second);
  }
  await core.advanceTo(SHIFT_SECONDS);
  await core.finishShift();
}

const rounded = (counters) => Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, Number(v.toFixed(6))]));

test("ambos agentes reciben exactamente los mismos pedidos, en el mismo segundo", async () => {
  const offers = { BASELINE: [], SMARTCOURIER: [] };
  const core = createCore(42026, {
    hooks: {
      onDecision: (d) => {
        if (d.order) offers[d.agentCode].push(`${d.order.external_order_number}@${d.second}:${d.order.final_payment}`);
      },
    },
  });
  await runFullShift(core, 60);

  assert.ok(offers.BASELINE.length > 10);
  assert.deepEqual(offers.BASELINE, offers.SMARTCOURIER);
});

test("la velocidad de la demo no altera ningún resultado (ticks de 15s vs 150s simulados)", async () => {
  const slow = createCore(7);
  const fast = createCore(7);
  await runFullShift(slow, 15); // 1x
  await runFullShift(fast, 150); // 10x

  for (const code of ["BASELINE", "SMARTCOURIER"]) {
    assert.deepEqual(fast.snapshot().agents[code].counters, slow.snapshot().agents[code].counters);
  }
});

test("cada pedido aceptado se cobra exactamente una vez y el pago coincide", async () => {
  const accepted = { BASELINE: new Map(), SMARTCOURIER: new Map() };
  const completed = { BASELINE: [], SMARTCOURIER: [] };
  const core = createCore(1003, {
    hooks: {
      onDecision: (d) => {
        if (["ACCEPT", "BATCH"].includes(d.decision)) accepted[d.agentCode].set(d.order.id, Number(d.order.final_payment));
      },
      onOrderCompleted: (e) => completed[e.agentCode].push(e.order.id),
    },
  });
  await runFullShift(core, 60);

  for (const code of ["BASELINE", "SMARTCOURIER"]) {
    const ids = completed[code];
    assert.equal(new Set(ids).size, ids.length, `${code}: pedido cobrado dos veces`);
    assert.deepEqual([...ids].sort(), [...accepted[code].keys()].sort(), `${code}: aceptado sin cobrar`);
    const expectedGross = [...accepted[code].values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(core.agents[code].counters.grossEarnings - expectedGross) < 0.01);
    assert.equal(core.agents[code].plan, null);
    assert.deepEqual(core.agents[code].commitments, {});
  }
});

test("al terminar un pedido se elimina la ruta y el repartidor queda en el destino", async () => {
  const cleared = [];
  let lastCompleted = null;
  const core = createCore(42026, {
    hooks: {
      onOrderCompleted: (e) => {
        if (e.agentCode === "BASELINE") lastCompleted = e;
      },
      onRouteChanged: (e) => {
        if (e.agentCode === "BASELINE" && e.route === null) cleared.push({ position: e.position, completed: lastCompleted });
      },
    },
  });
  await runFullShift(core, 60);

  assert.ok(cleared.length > 0);
  for (const { position, completed } of cleared) {
    assert.equal(position.lat, Number(completed.order.dropoff_lat));
    assert.equal(position.lng, Number(completed.order.dropoff_lng));
  }
});

async function coreWithBothAgentsDelivering(seed = 42026) {
  const core = createCore(seed, { smartPolicy: "score" });
  await core.prepare();
  for (let second = 60; second < SHIFT_SECONDS; second += 60) {
    await core.advanceTo(second);
    if (Object.values(core.agents).every((a) => a.plan?.kind === "DELIVERY")) return core;
  }
  throw new Error("no hubo un momento con ambos agentes entregando");
}

test("un evento de tráfico re-temporiza las rutas activas de TODOS los agentes y conserva la promesa", async () => {
  const core = await coreWithBothAgentsDelivering();
  const before = Object.fromEntries(
    Object.values(core.agents).map((a) => [a.code, { end: a.plan.endSecond, commitments: { ...a.commitments } }])
  );
  const retimed = [];
  core.hooks = { onRouteChanged: (e) => retimed.push(e.agentCode) };

  const effect = await core.applyEvent("TRAFFIC_INCREASED", { level: "SEVERE" });

  assert.deepEqual([...effect.retimedAgents].sort(), ["BASELINE", "SMARTCOURIER"]);
  assert.deepEqual([...retimed].sort(), ["BASELINE", "SMARTCOURIER"]);
  for (const agent of Object.values(core.agents)) {
    assert.ok(agent.plan.endSecond > before[agent.code].end, `${agent.code}: la ruta debe tardar más`);
    assert.deepEqual(agent.commitments, before[agent.code].commitments, "la hora comprometida no cambia");
    assert.ok(agent.plan.legs.every((leg) => leg.trafficVersion === core.traffic.version));
  }
});

test("el retraso se mide contra la hora comprometida", async () => {
  const core = await coreWithBothAgentsDelivering();
  await core.applyEvent("TRAFFIC_INCREASED", { level: "SEVERE" });
  const delays = [];
  core.hooks = { onOrderCompleted: (e) => delays.push(e) };
  await core.advanceTo(SHIFT_SECONDS);

  const first = delays[0];
  assert.ok(first.promisedSecond !== null);
  assert.equal(first.delaySeconds, first.second - first.promisedSecond);
  assert.ok(delays.some((d) => d.delaySeconds > 60), "con tráfico severo repentino algún pedido llega tarde");
  assert.ok(Object.values(core.agents).some((a) => a.counters.lateDeliveries > 0));
});

test("perfiles por vehículo: la bici tarda más por km y cuesta menos que la moto", async () => {
  const bike = createCore(9, { preferences: { vehicle_type: "bike" } });
  const moto = createCore(9, { preferences: { vehicle_type: "motorcycle" } });
  await bike.prepare();
  await moto.prepare();
  const release = bike.simulationOrders[0].spec.releaseSecond;
  await bike.advanceTo(release);
  await moto.advanceTo(release);

  const bikeOrder = bike.orders.get(1);
  const motoOrder = moto.orders.get(1);
  assert.equal(bikeOrder.distance_km, motoOrder.distance_km, "misma geometría de calles");
  assert.ok(Number(bikeOrder.estimated_time_minutes) > Number(motoOrder.estimated_time_minutes));
  assert.ok(bike.costPerKm < moto.costPerKm);
});

test("recuperación: continuar desde un snapshot a mitad del recorrido da el mismo estado final", async () => {
  const continuous = createCore(1011);
  await runFullShift(continuous, 60);

  const first = createCore(1011);
  await first.prepare();
  let midSecond = null;
  for (let second = 60; second < SHIFT_SECONDS; second += 60) {
    await first.advanceTo(second);
    const inTransit = Object.values(first.agents).some(
      (a) => a.plan && a.plan.legs.some((leg) => leg.fromSecond < second && second < leg.toSecond)
    );
    if (second > 3600 && inTransit) {
      midSecond = second;
      break;
    }
  }
  assert.ok(midSecond, "debe haber un repartidor a mitad de un tramo");

  const snapshot = JSON.parse(JSON.stringify(first.toSnapshot())); // lo que se guarda en la BD
  const restored = SimulationCore.fromSnapshot({
    snapshot,
    simulationOrders: JSON.parse(JSON.stringify(first.simulationOrders)),
    options: { simulationId: "test", seed: 1011, durationSeconds: SHIFT_SECONDS, getRoute },
  });
  for (let second = midSecond + 60; second < SHIFT_SECONDS; second += 60) await restored.advanceTo(second);
  await restored.advanceTo(SHIFT_SECONDS);
  await restored.finishShift();

  for (const code of ["BASELINE", "SMARTCOURIER"]) {
    assert.deepEqual(rounded(restored.agents[code].counters), rounded(continuous.agents[code].counters), code);
    assert.deepEqual(restored.agents[code].position, continuous.agents[code].position);
  }
  assert.equal(restored.traffic.version, continuous.traffic.version);
});

test("aceptar vs esperar: simula desde el mismo estado sin mirar los pedidos reales futuros", async () => {
  const core = createCore(1011, { smartPolicy: "score" });
  await core.prepare();
  await core.advanceTo(core.simulationOrders[0].spec.releaseSecond);

  const order = core.orders.get(1);
  const agent = core.agents.SMARTCOURIER;
  agent.plan = null; // se evalúa estando libre
  agent.commitments = {};
  const plan = await core.buildPlan(
    agent,
    [
      {
        type: "PICKUP",
        orderNumber: 1,
        lat: Number(order.pickup_lat),
        lng: Number(order.pickup_lng),
        readySecond: order.created_at_simulation_second + Number(order.estimated_preparation_minutes) * 60,
      },
      { type: "DROPOFF", orderNumber: 1, lat: Number(order.dropoff_lat), lng: Number(order.dropoff_lng) },
    ],
    core.clock,
    "DELIVERY"
  );

  const first = await compareAcceptVsWait({ core, order, acceptPlan: plan });
  // Alterar los pedidos reales que aún no llegan no debe cambiar nada.
  core.simulationOrders = core.simulationOrders.map((e) => ({ ...e, spec: { ...e.spec, flatFee: 9999 } }));
  const second = await compareAcceptVsWait({ core, order, acceptPlan: plan });

  assert.deepEqual(second, first);
  assert.equal(first.scenarios, 6);
  assert.ok(first.accept.p10 <= first.accept.mean && first.accept.mean <= first.accept.p90);
  assert.ok(first.wait.p10 <= first.wait.mean && first.wait.mean <= first.wait.p90);
  assert.equal(core.clock, order.created_at_simulation_second, "simular no avanza el reloj real");
});

test("SmartCourier supera a Baseline en ganancia neta por hora trabajada (mismas condiciones)", async () => {
  let baseline = 0;
  let smart = 0;
  for (const seed of [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010]) {
    const core = createCore(seed);
    await runFullShift(core, 300);
    const perHour = (code) => {
      const c = core.agents[code].counters;
      return (c.grossEarnings - c.operatingCost) / ((SHIFT_SECONDS / 60 + c.overtimeMinutes) / 60);
    };
    baseline += perHour("BASELINE");
    smart += perHour("SMARTCOURIER");
  }

  assert.ok(smart > baseline, `smart=${smart.toFixed(2)} baseline=${baseline.toFixed(2)}`);
});
