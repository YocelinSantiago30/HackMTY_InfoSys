// Sección 59: prueba obligatoria de reproducibilidad. Se mockea
// routingService.getRoute para eliminar la dependencia de red real (OSRM)
// — sin eso la prueba sería inestable por latencia/disponibilidad, no por
// nada relacionado con la seed. Todo lo demás (coordenadas, comercio,
// tráfico, demanda, surge, paquete) debe salir de la seed exclusivamente.
const test = require("node:test");
const assert = require("node:assert/strict");
const routingService = require("../src/services/routing.service");
const SimulationRandomService = require("../src/simulation/SimulationRandomService");
const { buildOrder } = require("../src/simulation/OrderGenerator");

const FIXED_ROUTE = { distanceKm: 5, durationMinutes: 12, geometry: null, source: "ROUTED" };

test("misma seed produce pedidos idénticos (sección 59)", async (t) => {
  t.mock.method(routingService, "getRoute", async () => ({ ...FIXED_ROUTE }));

  const randomA = new SimulationRandomService(12345);
  const orderA = await buildOrder({
    random: randomA,
    simulationId: "sim-a",
    currentSecond: 0,
    orderNumber: 1,
  });

  const randomB = new SimulationRandomService(12345);
  const orderB = await buildOrder({
    random: randomB,
    simulationId: "sim-b", // a propósito distinto: no debe afectar el resto
    currentSecond: 0,
    orderNumber: 1,
  });

  const { simulation_id: idA, ...restA } = orderA;
  const { simulation_id: idB, ...restB } = orderB;

  assert.notEqual(idA, idB); // confirma que sí difieren donde deben
  assert.deepEqual(restA, restB); // todo lo demás, idéntico
});

test("misma seed produce una secuencia de varios pedidos idéntica", async (t) => {
  t.mock.method(routingService, "getRoute", async () => ({ ...FIXED_ROUTE }));

  async function generateFive(seed) {
    const random = new SimulationRandomService(seed);
    const orders = [];
    for (let i = 1; i <= 5; i++) {
      const order = await buildOrder({
        random,
        simulationId: "sim",
        currentSecond: i * 15,
        orderNumber: i,
      });
      orders.push(order);
    }
    return orders;
  }

  const ordersA = await generateFive(42026);
  const ordersB = await generateFive(42026);

  assert.deepEqual(ordersA, ordersB);
});

test("seeds distintas producen pedidos distintos", async (t) => {
  t.mock.method(routingService, "getRoute", async () => ({ ...FIXED_ROUTE }));

  const orderA = await buildOrder({
    random: new SimulationRandomService(1),
    simulationId: "sim",
    currentSecond: 0,
    orderNumber: 1,
  });
  const orderB = await buildOrder({
    random: new SimulationRandomService(2),
    simulationId: "sim",
    currentSecond: 0,
    orderNumber: 1,
  });

  assert.notDeepEqual(orderA, orderB);
});
