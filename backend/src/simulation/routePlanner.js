// Geometría y línea de tiempo de la ruta de un repartidor. Funciones puras:
// no conocen la base de datos, sockets ni cuál agente las usa. Todo lo que
// producen es JSON plano, para poder guardarlo y recuperar la simulación.
const { haversineDistanceKm } = require("../utils/geo");

// stop: { type: "PICKUP" | "DROPOFF" | "REPOSITION", orderNumber, lat, lng, readySecond? }
// leg:  { distanceKm, durationMinutes, baseDistanceKm, baseDurationMinutes, coordinates?, trafficVersion }

function legSeconds(leg) {
  return Math.max(0, Math.round(leg.durationMinutes * 60));
}

// OSRM "ajusta" origen y destino a la calle más cercana, así que su
// geometría puede empezar/terminar lejos del punto real. Se cierra la línea
// en ambos extremos para que el trazo llegue al repartidor y a la parada.
function legCoordinates(leg, from, to) {
  const start = [from.lng, from.lat];
  const end = [to.lng, to.lat];
  if (!leg.coordinates?.length) return [start, end];
  return [start, ...leg.coordinates, end];
}

function buildTimeline({ startSecond, start, stops, legs }) {
  let clock = startSecond;
  let previous = start;

  const timedLegs = [];
  const timedStops = [];

  stops.forEach((stop, index) => {
    const leg = legs[index];
    const fromSecond = clock;
    clock += legSeconds(leg);

    timedLegs.push({
      fromSecond,
      toSecond: clock,
      distanceKm: Number(leg.distanceKm),
      baseDistanceKm: Number(leg.baseDistanceKm ?? leg.distanceKm),
      baseDurationMinutes: Number(leg.baseDurationMinutes ?? leg.durationMinutes),
      trafficVersion: leg.trafficVersion ?? 0,
      coordinates: legCoordinates(leg, previous, stop),
      accruedKm: 0,
    });

    const arriveSecond = clock;
    if (stop.type === "PICKUP") clock = Math.max(clock, stop.readySecond ?? clock);

    timedStops.push({ ...stop, arriveSecond, departSecond: clock, done: false });
    previous = stop;
  });

  return {
    startSecond,
    endSecond: clock,
    legs: timedLegs,
    stops: timedStops,
    totalKm: timedLegs.reduce((sum, leg) => sum + leg.distanceKm, 0),
  };
}

function segmentLengths(coordinates) {
  const lengths = [];
  for (let i = 1; i < coordinates.length; i++) {
    const [lng1, lat1] = coordinates[i - 1];
    const [lng2, lat2] = coordinates[i];
    lengths.push(haversineDistanceKm(lat1, lng1, lat2, lng2));
  }
  return lengths;
}

// Punto a una fracción (0-1) de una polilínea [[lng, lat], ...] y el índice
// del segmento donde cae.
function locateAlong(coordinates, fraction) {
  const last = coordinates[coordinates.length - 1];
  if (coordinates.length === 1 || fraction <= 0) {
    return { point: { lat: coordinates[0][1], lng: coordinates[0][0] }, segment: 0 };
  }

  const lengths = segmentLengths(coordinates);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total === 0 || fraction >= 1) return { point: { lat: last[1], lng: last[0] }, segment: lengths.length - 1 };

  let remaining = total * fraction;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      const [lng1, lat1] = coordinates[i];
      const [lng2, lat2] = coordinates[i + 1];
      return { point: { lat: lat1 + (lat2 - lat1) * t, lng: lng1 + (lng2 - lng1) * t }, segment: i };
    }
    remaining -= lengths[i];
  }
  return { point: { lat: last[1], lng: last[0] }, segment: lengths.length - 1 };
}

function pointAlong(coordinates, fraction) {
  return locateAlong(coordinates, fraction).point;
}

function legFraction(leg, second) {
  const duration = leg.toSecond - leg.fromSecond;
  if (duration <= 0) return second >= leg.toSecond ? 1 : 0;
  return Math.min(1, Math.max(0, (second - leg.fromSecond) / duration));
}

// Lo que falta de un tramo a partir de `second`, sin volver a llamar a OSRM:
// misma polilínea recortada y la parte proporcional de distancia/tiempo base.
function remainingLeg(leg, second) {
  const fraction = legFraction(leg, second);
  const { point, segment } = locateAlong(leg.coordinates, fraction);
  return {
    baseDistanceKm: leg.baseDistanceKm * (1 - fraction),
    baseDurationMinutes: leg.baseDurationMinutes * (1 - fraction),
    coordinates: [[point.lng, point.lat], ...leg.coordinates.slice(segment + 1)],
  };
}

function positionAt(plan, second) {
  for (let i = 0; i < plan.legs.length; i++) {
    const leg = plan.legs[i];
    const stop = plan.stops[i];

    if (second < leg.toSecond) return pointAlong(leg.coordinates, legFraction(leg, second));
    if (second < stop.departSecond) return { lat: stop.lat, lng: stop.lng }; // esperando la preparación
  }

  const lastStop = plan.stops[plan.stops.length - 1];
  return { lat: lastStop.lat, lng: lastStop.lng };
}

// Todas las secuencias válidas (cada PICKUP antes del DROPOFF de su pedido).
// Con máximo 2 pedidos en ruta son a lo mucho 4 paradas → fuerza bruta exacta.
function validSequences(stops) {
  const results = [];

  function extend(sequence, remaining) {
    if (remaining.length === 0) {
      results.push(sequence);
      return;
    }
    remaining.forEach((stop, index) => {
      if (stop.type === "DROPOFF") {
        const pickupPending = remaining.some((o) => o.type === "PICKUP" && o.orderNumber === stop.orderNumber);
        if (pickupPending) return;
      }
      extend([...sequence, stop], remaining.filter((_, i) => i !== index));
    });
  }

  extend([], stops);
  return results;
}

// Mejor secuencia con ventanas de tiempo: cada pedido ya comprometido debe
// entregarse antes de `promises[orderNumber] + toleranceSeconds`. Entre las
// factibles gana la que termina antes (y luego la de menos km). Si ninguna
// cumple las promesas devuelve null. (OR-Tools soporta lo mismo con una
// dimensión de tiempo; con ≤4 paradas la búsqueda exacta es suficiente.)
function bestSequence({ startSecond, start, stops, estimateLeg, promises = {}, toleranceSeconds = Infinity }) {
  let best = null;

  for (const sequence of validSequences(stops)) {
    let previous = start;
    const legs = sequence.map((stop) => {
      const leg = estimateLeg(previous, stop);
      previous = stop;
      return leg;
    });
    const timeline = buildTimeline({ startSecond, start, stops: sequence, legs });

    const keepsPromises = timeline.stops.every(
      (s) => s.type !== "DROPOFF" || promises[s.orderNumber] === undefined || s.arriveSecond <= promises[s.orderNumber] + toleranceSeconds
    );
    if (!keepsPromises) continue;

    if (!best || timeline.endSecond < best.endSecond || (timeline.endSecond === best.endSecond && timeline.totalKm < best.totalKm)) {
      best = { sequence, endSecond: timeline.endSecond, totalKm: timeline.totalKm };
    }
  }

  return best?.sequence ?? null;
}

module.exports = {
  buildTimeline,
  positionAt,
  pointAlong,
  remainingLeg,
  legFraction,
  bestSequence,
  validSequences,
};
