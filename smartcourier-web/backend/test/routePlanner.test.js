const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTimeline, positionAt, validSequences, bestSequence, remainingLeg } = require("../src/simulation/routePlanner");

const START = { lat: 25.68, lng: -100.32 };
const PICKUP = { type: "PICKUP", orderNumber: 1, lat: 25.69, lng: -100.31, readySecond: 900 };
const DROPOFF = { type: "DROPOFF", orderNumber: 1, lat: 25.7, lng: -100.3 };

function plan() {
  return buildTimeline({
    startSecond: 0,
    start: START,
    stops: [PICKUP, DROPOFF],
    legs: [
      { distanceKm: 2, durationMinutes: 5 },
      { distanceKm: 3, durationMinutes: 10 },
    ],
  });
}

test("repartidor -> pickup -> destino, esperando la preparación en el pickup", () => {
  const p = plan();

  assert.equal(p.stops[0].arriveSecond, 300); // 5 min de camino
  assert.equal(p.stops[0].departSecond, 900); // la comida está lista al minuto 15
  assert.equal(p.stops[1].arriveSecond, 1500); // + 10 min de entrega
  assert.equal(p.endSecond, 1500);
  assert.equal(p.totalKm, 5);
});

test("la posición avanza sobre la ruta y termina en el destino", () => {
  const p = plan();

  assert.deepEqual(positionAt(p, 0), START);
  assert.deepEqual(positionAt(p, 600), { lat: PICKUP.lat, lng: PICKUP.lng }); // esperando
  const middle = positionAt(p, 1200); // mitad de la entrega
  assert.ok(middle.lat > PICKUP.lat && middle.lat < DROPOFF.lat);
  assert.deepEqual(positionAt(p, 5000), { lat: DROPOFF.lat, lng: DROPOFF.lng });
});

test("el tramo restante conserva la geometría y la parte proporcional sin llamar a OSRM", () => {
  const leg = plan().legs[1]; // 900 -> 1500 s
  const rest = remainingLeg(leg, 1200);

  assert.equal(rest.baseDistanceKm, 1.5);
  assert.equal(rest.baseDurationMinutes, 5);
  const [lng, lat] = rest.coordinates[0];
  assert.deepEqual({ lat, lng }, positionAt(plan(), 1200));
});

test("las secuencias de batching siempre recogen antes de entregar", () => {
  const stops = [PICKUP, DROPOFF, { ...PICKUP, orderNumber: 2 }, { ...DROPOFF, orderNumber: 2 }];
  const sequences = validSequences(stops);

  assert.equal(sequences.length, 6); // 4! / (2 × 2)
  for (const sequence of sequences) {
    for (const stop of sequence.filter((s) => s.type === "DROPOFF")) {
      const pickupIndex = sequence.findIndex((s) => s.type === "PICKUP" && s.orderNumber === stop.orderNumber);
      assert.ok(pickupIndex < sequence.indexOf(stop));
    }
  }
});

test("ventanas de tiempo: se descartan órdenes de paradas que rompen una promesa", () => {
  const estimateLeg = () => ({ distanceKm: 1, durationMinutes: 10 });
  const committedDropoff = { type: "DROPOFF", orderNumber: 1, lat: 25.7, lng: -100.3 };
  const newPickup = { type: "PICKUP", orderNumber: 2, lat: 25.71, lng: -100.29, readySecond: 0 };
  const newDropoff = { type: "DROPOFF", orderNumber: 2, lat: 25.72, lng: -100.28 };
  const stops = [committedDropoff, newPickup, newDropoff];

  // El pedido 1 prometió llegar al minuto 10: solo sirve entregarlo primero.
  const sequence = bestSequence({ startSecond: 0, start: START, stops, estimateLeg, promises: { 1: 600 }, toleranceSeconds: 0 });
  assert.equal(sequence[0].orderNumber, 1);

  // Promesa imposible de cumplir → ninguna secuencia factible.
  assert.equal(bestSequence({ startSecond: 0, start: START, stops, estimateLeg, promises: { 1: 60 }, toleranceSeconds: 0 }), null);
});
