// Flujo de pedidos de un turno a partir de su configuración. Misma seed →
// flujo idéntico byte a byte (courier/evaluation_protocol.md §1): solo usa el
// generador sembrado, nunca Math.random ni el reloj del sistema.
const crypto = require("crypto");
const SimulationRandomService = require("../simulation/SimulationRandomService");
const { ZONES, PLATFORMS, VEHICLES, DELIVERY_PROMISE_SLACK_MIN, DECISION_WINDOW_SECONDS, DEFAULT_SHIFT_DATE, DEFAULT_SHIFT_START } = require("./config");
const { toSeconds, toIso, hourOfDay, round2, zone, zoneDistanceKm, zoneSurge, normalizeShock } = require("./world");

// Ofertas por hora en toda la ciudad (antes de aplicar radio y disponibilidad).
// Con pocas ofertas ser selectivo nunca paga; en hora pico las apps inundan.
const BASE_OFFERS_PER_HOUR = 40;

// Intensidad relativa de pedidos por hora del día (comida y cena).
function hourlyDemand(hour) {
  if (hour >= 12 && hour < 15) return 1.3;
  if (hour >= 18 && hour < 22) return 1.5;
  if (hour >= 22 || hour < 1) return 0.8;
  if (hour >= 15 && hour < 18) return 0.8;
  if (hour >= 9 && hour < 12) return 0.7;
  return 0.3;
}
const MAX_HOURLY_DEMAND = 1.5;

function pickWeighted(random, items, weight) {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = random.next() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

function normalizeConfig(config) {
  const vehicle = config.vehicle;
  if (!VEHICLES[vehicle]) throw new Error(`vehicle debe ser moto, car o bike (recibido: ${vehicle})`);
  const startZone = Number(config.start_location_zone);
  zone(startZone); // valida

  const shiftStart = config.shift_start_time || `${DEFAULT_SHIFT_DATE}T${DEFAULT_SHIFT_START}`;
  const startSeconds = toSeconds(shiftStart);
  const endSeconds = startSeconds + Number(config.shift_hours) * 3600;

  return {
    seed: Number(config.seed),
    shift_hours: Number(config.shift_hours),
    vehicle,
    start_location_zone: startZone,
    shift_start_time: toIso(startSeconds),
    shift_end_time: toIso(endSeconds),
    startSeconds,
    endSeconds,
    shocks: config.shocks,
  };
}

// Disrupciones sembradas (si la configuración no trae las suyas).
function seededShocks(random, cfg, orderIds) {
  const span = cfg.endSeconds - cfg.startSeconds;
  const at = (fraction) => toIso(cfg.startSeconds + Math.floor(span * fraction / 60) * 60);
  const shocks = [
    {
      event: "shock",
      sim_time: at(random.nextFloat(0.15, 0.45)),
      shock_type: "surge",
      zone: pickWeighted(random, ZONES, (z) => z.demand).id,
      multiplier: round2(random.nextFloat(1.3, 1.8)),
      duration_min: random.nextInt(20, 45),
    },
    { event: "shock", sim_time: at(random.nextFloat(0.5, 0.8)), shock_type: "rain", duration_min: random.nextInt(30, 60) },
    {
      event: "shock",
      sim_time: at(random.nextFloat(0.3, 0.7)),
      shock_type: "closure",
      zone: random.pick(ZONES).id,
      road: "Av. Constitución",
      duration_min: random.nextInt(30, 60),
    },
  ];
  if (orderIds.length) {
    const orderId = orderIds[random.nextInt(0, orderIds.length - 1)];
    shocks.push({ event: "shock", sim_time: null, shock_type: "delay", order_id: orderId, slip_min: random.nextInt(8, 15) });
  }
  return shocks;
}

function packageFor(random) {
  const w = random.next();
  const weight = w < 0.85 ? random.nextFloat(0.3, 4) : w < 0.95 ? random.nextFloat(4, 10) : random.nextFloat(10, 30);
  const v = random.next();
  const volume = v < 0.7 ? random.nextFloat(1, 10) : v < 0.92 ? random.nextFloat(10, 35) : random.nextFloat(35, 120);
  return { weight_kg: round2(weight), volume_liters: round2(volume) };
}

function generateShift(config) {
  const cfg = normalizeConfig(config);
  const random = new SimulationRandomService(cfg.seed >>> 0);
  const profile = VEHICLES[cfg.vehicle];

  // Llegadas de Poisson no homogéneas por "thinning" (determinista).
  const maxRatePerSecond = (BASE_OFFERS_PER_HOUR * MAX_HOURLY_DEMAND) / 3600;
  const orders = [];
  let t = cfg.startSeconds;
  for (;;) {
    t += -Math.log(1 - random.next()) / maxRatePerSecond;
    if (t >= cfg.endSeconds) break;
    const accept = random.next() < hourlyDemand(hourOfDay(t)) / MAX_HOURLY_DEMAND;
    const pickupZone = pickWeighted(random, ZONES, (z) => z.demand);
    const dropoffZone = pickWeighted(random, ZONES, (z) => Math.exp(-zoneDistanceKm(pickupZone.id, z.id) / 6) * (0.6 + z.demand));
    const jitter = random.nextFloat(0.85, 1.25);
    const intra = random.nextFloat(0.6, 2.8);
    const payNoise = random.nextFloat(-4, 4);
    const surgeRoll = random.next();
    const surgeValue = random.nextFloat(1.1, 1.5);
    const tipRoll = random.next();
    const tip = random.nextFloat(5, 25);
    const prep = random.nextInt(4, 20);
    const platform = random.pick(PLATFORMS);
    const pkg = packageFor(random);
    if (!accept) continue;

    const seconds = Math.floor(t);
    const delivery = pickupZone.id === dropoffZone.id ? intra : zoneDistanceKm(pickupZone.id, dropoffZone.id) * jitter;
    const peak = hourlyDemand(hourOfDay(seconds)) >= 1.3;
    const deliveryMin = (delivery / profile.speedKmh) * 60;

    orders.push({
      event: "order_offered",
      order_id: `ORD-${String(orders.length + 1).padStart(4, "0")}`,
      platform,
      sim_time: toIso(seconds),
      decision_deadline: toIso(seconds + DECISION_WINDOW_SECONDS),
      zone_pickup: pickupZone.id,
      zone_dropoff: dropoffZone.id,
      zone_pickup_name: pickupZone.name,
      zone_dropoff_name: dropoffZone.name,
      distance_delivery_km: round2(delivery),
      base_pay_mxn: round2(Math.max(25, 22 + 6.5 * delivery + payNoise)),
      est_tip_mxn: tipRoll < 0.4 ? 0 : round2(tip),
      surge_multiplier: peak && surgeRoll < 0.35 ? round2(surgeValue) : 1,
      restaurant_prep_min: prep,
      weight_kg: pkg.weight_kg,
      volume_liters: pkg.volume_liters,
      vehicle: cfg.vehicle,
      delivery_deadline: toIso(seconds + (prep + deliveryMin + DELIVERY_PROMISE_SLACK_MIN) * 60),
    });
  }

  const shockRandom = new SimulationRandomService((cfg.seed ^ 0x51ed270b) >>> 0);
  const shocks = (cfg.shocks ?? seededShocks(shockRandom, cfg, orders.map((o) => o.order_id))).map((s) => ({
    ...s,
    sim_time: s.sim_time ?? orders.find((o) => o.order_id === s.order_id)?.sim_time ?? cfg.shift_start_time,
  }));

  // El surge de un shock afecta a los pedidos que nacen en esa zona mientras dura.
  const internalShocks = shocks.map(normalizeShock);
  for (const order of orders) {
    const factor = zoneSurge(internalShocks, order.zone_pickup, toSeconds(order.sim_time));
    if (factor !== 1) order.surge_multiplier = round2(order.surge_multiplier * factor);
  }

  return { config: cfg, orders, shocks };
}

// Serialización canónica del flujo (pedidos + shocks) y su huella.
function streamJsonl(shift) {
  const lines = [...shift.orders, ...shift.shocks].map((item) => JSON.stringify(item));
  return `${lines.join("\n")}\n`;
}

function streamSha256(shift) {
  return crypto.createHash("sha256").update(streamJsonl(shift)).digest("hex");
}

module.exports = {
  generateShift,
  normalizeConfig,
  streamJsonl,
  streamSha256,
  hourlyDemand,
  BASE_OFFERS_PER_HOUR,
};
