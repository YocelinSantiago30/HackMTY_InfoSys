const test = require("node:test");
const assert = require("node:assert/strict");
const SimulationRandomService = require("../src/simulation/SimulationRandomService");

test("misma seed produce exactamente la misma secuencia", () => {
  const a = new SimulationRandomService(42026);
  const b = new SimulationRandomService(42026);

  for (let i = 0; i < 20; i++) {
    assert.equal(a.next(), b.next());
  }
});

test("seeds distintas producen secuencias distintas", () => {
  const a = new SimulationRandomService(1);
  const b = new SimulationRandomService(2);

  const sequenceA = Array.from({ length: 10 }, () => a.next());
  const sequenceB = Array.from({ length: 10 }, () => b.next());

  assert.notDeepEqual(sequenceA, sequenceB);
});

test("next() siempre está en [0, 1)", () => {
  const random = new SimulationRandomService(7);

  for (let i = 0; i < 1000; i++) {
    const value = random.next();
    assert.ok(value >= 0 && value < 1, `valor fuera de rango: ${value}`);
  }
});

test("nextInt respeta los límites inclusive", () => {
  const random = new SimulationRandomService(99);

  for (let i = 0; i < 500; i++) {
    const value = random.nextInt(5, 10);
    assert.ok(value >= 5 && value <= 10, `valor fuera de rango: ${value}`);
    assert.ok(Number.isInteger(value));
  }
});

test("pick siempre retorna un elemento del arreglo", () => {
  const random = new SimulationRandomService(123);
  const options = ["a", "b", "c"];

  for (let i = 0; i < 50; i++) {
    assert.ok(options.includes(random.pick(options)));
  }
});
