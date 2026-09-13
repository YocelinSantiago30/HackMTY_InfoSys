// Predicción de tiempos, distancia y carga de tomar un pedido, con o sin
// pedidos en curso. La usan el fast path (con los shocks conocidos al
// decidir) y el simulador (con los shocks reales, para auditar).
const { travelMinutes, zoneDistanceKm, toSeconds, prepSlipMinutes, round2 } = require("./world");

function orderDeadline(item) {
  return item.delivery_deadline ? toSeconds(item.delivery_deadline) : null;
}

// Tramo de entrega: salir en `seconds` de una zona a otra.
function leg(km, seconds, fromZone, toZone, ctx) {
  const minutes = travelMinutes({ km, vehicle: ctx.vehicle, seconds, shocks: ctx.shocks, fromZone, toZone });
  return { km, arrive: seconds + minutes * 60 };
}

// Pedido solo: repartidor → pickup (espera preparación) → destino.
function planSingle(order, startSeconds, fromZone, pickupKm, ctx) {
  const toPickup = leg(pickupKm, startSeconds, fromZone, order.zone_pickup, ctx);
  const slip = prepSlipMinutes(ctx.shocks, order.order_id);
  const ready = toSeconds(order.sim_time) + (Number(order.restaurant_prep_min || 0) + slip) * 60;
  const departPickup = Math.max(toPickup.arrive, ready);
  const delivery = leg(Number(order.distance_delivery_km), departPickup, order.zone_pickup, order.zone_dropoff, ctx);

  return {
    pickupMin: (toPickup.arrive - startSeconds) / 60,
    waitMin: (departPickup - toPickup.arrive) / 60,
    deliveryMin: (delivery.arrive - departPickup) / 60,
    dropoffSeconds: delivery.arrive,
    km: pickupKm + Number(order.distance_delivery_km),
  };
}

function remainingSeconds(item, now) {
  if (item.remaining_min !== undefined) return Number(item.remaining_min) * 60;
  if (item.eta) return Math.max(0, toSeconds(item.eta) - now);
  return 0;
}

// ctx: { vehicle, shocks, nowSeconds, courierZone, continuousRidingMin, inFlight }
function planTrip(order, ctx) {
  const now = ctx.nowSeconds;
  const inFlight = ctx.inFlight || [];
  const pickupKm = Number(order.distance_pickup_km);
  const newLoad = { weight: Number(order.weight_kg || 0), volume: Number(order.volume_liters || 0) };
  const base = {
    startSeconds: now,
    continuousRidingStartMin: Number(ctx.continuousRidingMin || 0),
    zoneDropoff: order.zone_dropoff,
    deadheadKm: pickupKm,
  };

  if (inFlight.length === 0) {
    const single = planSingle(order, now, ctx.courierZone, pickupKm, ctx);
    return {
      ...base,
      ...single,
      completionSeconds: single.dropoffSeconds,
      totalMin: (single.dropoffSeconds - now) / 60,
      loadWeightKg: newLoad.weight,
      loadVolumeLiters: newLoad.volume,
      sequence: "single",
      lateOrders: [],
    };
  }

  // Apilado: se prueban los dos órdenes posibles y gana el factible que termina antes.
  const carried = inFlight.map((item) => ({ ...item, remaining: remainingSeconds(item, now) }));
  const currentCompletion = now + Math.max(...carried.map((c) => c.remaining));
  const last = carried.reduce((a, b) => (b.remaining > a.remaining ? b : a));
  const newDeadline = orderDeadline(order);

  // A) terminar lo que lleva y luego ir por el pedido nuevo.
  const fromLast = last.zone_dropoff !== undefined ? zoneDistanceKm(last.zone_dropoff, order.zone_pickup) : pickupKm;
  const afterSingle = planSingle(order, currentCompletion, last.zone_dropoff ?? ctx.courierZone, fromLast, ctx);
  const planA = {
    sequence: "finish_in_flight_first",
    dropoffSeconds: afterSingle.dropoffSeconds,
    completionSeconds: afterSingle.dropoffSeconds,
    km: afterSingle.km,
    deadheadKm: fromLast,
    pickupMin: (currentCompletion - now) / 60 + afterSingle.pickupMin,
    waitMin: afterSingle.waitMin,
    deliveryMin: afterSingle.deliveryMin,
    load: newLoad,
    lateOrders: [],
  };

  // B) recoger primero el nuevo y entregar todo en ruta.
  const single = planSingle(order, now, ctx.courierZone, pickupKm, ctx);
  let clock = single.dropoffSeconds - single.deliveryMin * 60; // salida del pickup
  let zoneAt = order.zone_pickup;
  let kmB = pickupKm;
  const lateB = [];
  for (const item of [...carried].sort((a, b) => (orderDeadline(a) ?? Infinity) - (orderDeadline(b) ?? Infinity))) {
    const km = item.zone_dropoff !== undefined ? zoneDistanceKm(zoneAt, item.zone_dropoff) : 0;
    clock = leg(km, clock, zoneAt, item.zone_dropoff, ctx).arrive;
    kmB += km;
    zoneAt = item.zone_dropoff ?? zoneAt;
    const deadline = orderDeadline(item);
    if (deadline !== null && clock > deadline) lateB.push(item.order_id);
  }
  const finalKm = zoneDistanceKm(zoneAt, order.zone_dropoff);
  const dropB = leg(finalKm, clock, zoneAt, order.zone_dropoff, ctx).arrive;
  const planB = {
    sequence: "pickup_new_first",
    dropoffSeconds: dropB,
    completionSeconds: dropB,
    km: kmB + finalKm,
    deadheadKm: pickupKm,
    pickupMin: single.pickupMin,
    waitMin: single.waitMin,
    deliveryMin: (dropB - (single.dropoffSeconds - single.deliveryMin * 60)) / 60,
    load: {
      weight: newLoad.weight + carried.reduce((s, c) => s + Number(c.weight_kg || 0), 0),
      volume: newLoad.volume + carried.reduce((s, c) => s + Number(c.volume_liters || 0), 0),
    },
    lateOrders: lateB,
  };

  const onTime = (plan) => plan.lateOrders.length === 0 && (newDeadline === null || plan.dropoffSeconds <= newDeadline);
  const candidates = [planA, planB].sort(
    (a, b) => Number(onTime(b)) - Number(onTime(a)) || a.completionSeconds - b.completionSeconds
  );
  const chosen = candidates[0];
  if (newDeadline !== null && chosen.dropoffSeconds > newDeadline) chosen.lateOrders = [...chosen.lateOrders, order.order_id];

  // Costos marginales: lo que agrega el pedido nuevo a lo que ya iba a hacer.
  const baselineKm = carried.reduce((s, c) => s + Number(c.remaining_km || 0), 0);
  return {
    ...base,
    sequence: chosen.sequence,
    pickupMin: chosen.pickupMin,
    waitMin: chosen.waitMin,
    deliveryMin: chosen.deliveryMin,
    dropoffSeconds: chosen.dropoffSeconds,
    completionSeconds: Math.max(chosen.completionSeconds, currentCompletion),
    totalMin: (Math.max(chosen.completionSeconds, currentCompletion) - currentCompletion) / 60,
    km: Math.max(0, chosen.km - baselineKm),
    deadheadKm: chosen.deadheadKm,
    loadWeightKg: chosen.load.weight,
    loadVolumeLiters: chosen.load.volume,
    lateOrders: chosen.lateOrders,
    alternatives: candidates.slice(1).map((c) => ({
      sequence: c.sequence,
      completion: round2((c.completionSeconds - now) / 60),
      lateOrders: c.lateOrders,
    })),
  };
}

module.exports = {
  planTrip,
};
