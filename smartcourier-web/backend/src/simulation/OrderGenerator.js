const { haversineDistanceKm, randomPointInRadius } = require("../utils/geo");
const routingService = require("../services/routing.service");
const { simulatedHourOfDay } = require("./simulatedTime");
const { ZONES, zoneDemandScore, zoneDemandLevel, nearestZone } = require("./zones");
const { baseLegFromRoute, effectiveLeg, round2 } = require("./economics");

const SERVICE_AREA_CENTER = { lat: 25.6866, lng: -100.3161 }; // Monterrey, NL
const SERVICE_AREA_RADIUS_KM = 8;
const MIN_DELIVERY_DISTANCE_KM = 0.8;
const MAX_DELIVERY_RADIUS_KM = 6;

// Los pedidos nacen cerca de las zonas con más demanda a esa hora (el resto,
// dispersos en el área de servicio). Así "estar en una zona de alta demanda"
// tiene un efecto físico real: pickups más cercanos.
const ZONE_PICKUP_PROBABILITY = 0.6;
const ZONE_PICKUP_RADIUS_KM = 2;
const DESTINATION_ZONE_RADIUS_KM = 4;

// Sección 16: tiempo simulado entre pedidos nuevos.
const MIN_ORDER_INTERVAL_SECONDS = 2 * 60;
const MAX_ORDER_INTERVAL_SECONDS = 6 * 60;

const URGENT_ORDER_EXPIRATION_SECONDS = 45;
const URGENT_ORDER_PAYMENT_BOOST = 1.3;
const ROUTE_RESOLUTION_CONCURRENCY = 4;

const MERCHANT_NAMES = [
  "Tacos El Rey",
  "Sushi Roma",
  "Pizza Fresca",
  "Burger Norte",
  "Café Barrio",
  "Pollo Feliz MTY",
  "Mariscos La Costa",
  "Pasta Bella",
  "Wok Express",
  "Tortas Don Beto",
];

function pickWeighted(random, weightedOptions) {
  const total = weightedOptions.reduce((sum, option) => sum + option.weight, 0);
  let roll = random.next() * total;

  for (const option of weightedOptions) {
    if (roll < option.weight) return option.value;
    roll -= option.weight;
  }

  return weightedOptions[weightedOptions.length - 1].value;
}

// Demanda del destino derivada de su ubicación real y la hora (no un dado):
// terminar cerca de una zona activa acerca el siguiente pickup.
function destinationDemandAt(lat, lng, hour) {
  const zone = nearestZone(lat, lng);
  if (zone.distanceKm > DESTINATION_ZONE_RADIUS_KM) return "LOW";
  return zoneDemandLevel(zone, hour);
}

function surgeForDemand(random, demand) {
  const surgeOptionsByDemand = {
    LOW: [
      { value: 1.0, weight: 9 },
      { value: 1.1, weight: 1 },
    ],
    MEDIUM: [
      { value: 1.0, weight: 6 },
      { value: 1.1, weight: 3 },
      { value: 1.2, weight: 1 },
    ],
    HIGH: [
      { value: 1.0, weight: 2 },
      { value: 1.1, weight: 3 },
      { value: 1.2, weight: 3 },
      { value: 1.5, weight: 2 },
    ],
    VERY_HIGH: [
      { value: 1.2, weight: 2 },
      { value: 1.5, weight: 4 },
      { value: 2.0, weight: 3 },
    ],
  };

  return pickWeighted(random, surgeOptionsByDemand[demand] || surgeOptionsByDemand.MEDIUM);
}

function packageSizeAndWeight(random) {
  const size = pickWeighted(random, [
    { value: "SMALL", weight: 5 },
    { value: "MEDIUM", weight: 4 },
    { value: "LARGE", weight: 1 },
  ]);

  const weightRangeBySize = {
    SMALL: [0.3, 2],
    MEDIUM: [2, 5],
    LARGE: [5, 10],
  };

  const [min, max] = weightRangeBySize[size];

  return { size, weight: Number(random.nextFloat(min, max).toFixed(2)) };
}

function pickupPoint(random, hour) {
  if (random.next() < ZONE_PICKUP_PROBABILITY) {
    const zone = pickWeighted(
      random,
      ZONES.map((z) => ({ value: z, weight: Math.max(0.05, zoneDemandScore(z, hour)) }))
    );
    return randomPointInRadius(random, zone, ZONE_PICKUP_RADIUS_KM);
  }
  return randomPointInRadius(random, SERVICE_AREA_CENTER, SERVICE_AREA_RADIUS_KM);
}

// Parte aleatoria de un pedido. Consume SIEMPRE la misma cantidad de números
// de la seed, sin importar eventos activos: los eventos se aplican después
// (finalizeOrder), así un evento no desplaza la secuencia de pedidos futuros.
function buildOrderSpec({ random, releaseSecond, orderNumber, forceUrgent = false }) {
  const hour = simulatedHourOfDay(releaseSecond);
  const pickup = pickupPoint(random, hour);

  let dropoff;
  do {
    dropoff = randomPointInRadius(random, pickup, MAX_DELIVERY_RADIUS_KM);
  } while (haversineDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) < MIN_DELIVERY_DISTANCE_KM);

  const destinationDemand = destinationDemandAt(dropoff.lat, dropoff.lng, hour);
  const surgeMultiplier = surgeForDemand(random, destinationDemand);
  const perKmRate = random.nextFloat(9, 14); // $/km, tarifa realista Monterrey
  const flatFee = random.nextFloat(15, 25);
  const { size: packageSize, weight: packageWeight } = packageSizeAndWeight(random);
  const priority = forceUrgent || random.next() < 0.15 ? "HIGH" : "NORMAL";
  const expirationSeconds = forceUrgent ? URGENT_ORDER_EXPIRATION_SECONDS : random.nextInt(60, 180);

  return {
    orderNumber,
    releaseSecond,
    forceUrgent,
    merchantName: random.pick(MERCHANT_NAMES),
    pickup,
    dropoff,
    destinationDemand,
    surgeMultiplier,
    perKmRate,
    flatFee,
    packageSize,
    packageWeight,
    priority,
    expirationSeconds,
    preparationMinutes: random.nextInt(5, 20),
  };
}

function resolveSpecRoute(spec, getRoute = routingService.getRoute) {
  return getRoute({
    originLat: spec.pickup.lat,
    originLng: spec.pickup.lng,
    destinationLat: spec.dropoff.lat,
    destinationLng: spec.dropoff.lng,
  });
}

const DEFAULT_CONDITIONS = { level: "LOW", detourFactor: 1, version: 0 };
const DEFAULT_PROFILE = { speedKmh: null, durationFactor: 1, trafficSensitivity: 1 };

// Pedido final en el instante en que se publica: aplica los eventos activos
// (sección 26), el tráfico global vigente y el vehículo del repartidor sobre
// la parte aleatoria ya fijada por la seed.
function finalizeOrder({
  spec,
  route,
  simulationId,
  modifiers = {},
  conditions = DEFAULT_CONDITIONS,
  profile = DEFAULT_PROFILE,
}) {
  const destinationDemand = modifiers.destinationDemand || spec.destinationDemand;
  const surgeMultiplier = modifiers.surgeMultiplier || spec.surgeMultiplier;
  const delivery = effectiveLeg(baseLegFromRoute(route, profile), conditions, profile);

  const basePayment = round2(route.distanceKm * spec.perKmRate + spec.flatFee);
  const urgentBoost = spec.forceUrgent ? URGENT_ORDER_PAYMENT_BOOST : 1;

  return {
    simulation_id: simulationId,
    external_order_number: spec.orderNumber,
    merchant_name: spec.merchantName,
    pickup_lat: spec.pickup.lat,
    pickup_lng: spec.pickup.lng,
    dropoff_lat: spec.dropoff.lat,
    dropoff_lng: spec.dropoff.lng,
    base_payment: basePayment,
    surge_multiplier: surgeMultiplier,
    final_payment: round2(basePayment * surgeMultiplier * urgentBoost),
    distance_km: Number(delivery.distanceKm.toFixed(3)),
    estimated_time_minutes: round2(delivery.durationMinutes),
    route_source: conditions.detourFactor > 1 ? "ESTIMATED" : route.source,
    traffic_level: conditions.level,
    destination_demand: destinationDemand,
    priority: spec.priority,
    package_size: spec.packageSize,
    package_weight: spec.packageWeight,
    estimated_preparation_minutes: spec.preparationMinutes,
    expiration_seconds: spec.expirationSeconds,
    created_at_simulation_second: spec.releaseSecond,
  };
}

async function buildOrder({ random, simulationId, currentSecond, orderNumber, modifiers = {}, forceUrgent = false }) {
  const spec = buildOrderSpec({ random, releaseSecond: currentSecond, orderNumber, forceUrgent });
  const route = await resolveSpecRoute(spec);
  return finalizeOrder({ spec, route, simulationId, modifiers });
}

// Flujo de pedidos SINTÉTICO desde `fromSecond`: misma distribución que la
// demanda real, pero con otra semilla. SmartCourier lo usa para imaginar
// escenarios futuros sin ver los pedidos reales que todavía no llegan.
async function generateOrderStream({ random, fromSecond, toSecond, firstOrderNumber, getRoute }) {
  const entries = [];
  let releaseSecond = fromSecond + random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);
  let orderNumber = firstOrderNumber;

  while (releaseSecond < toSecond) {
    const spec = buildOrderSpec({ random, releaseSecond, orderNumber: orderNumber++ });
    entries.push({ spec, route: await resolveSpecRoute(spec, getRoute) });
    releaseSecond += random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);
  }

  return entries;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// La lista ÚNICA de pedidos del turno (simulationOrders): se genera una vez
// desde la seed y ambos agentes reciben exactamente los mismos pedidos, en
// el mismo instante, con las mismas distancias y pagos.
async function generateSimulationOrders({ random, durationSeconds, startSecond = 0, getRoute = routingService.getRoute }) {
  const specs = [];
  let releaseSecond = random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);
  let orderNumber = 0;

  while (releaseSecond < durationSeconds) {
    orderNumber += 1;
    specs.push(buildOrderSpec({ random, releaseSecond, orderNumber }));
    releaseSecond += random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);
  }

  const pending = specs.filter((spec) => spec.releaseSecond > startSecond);
  const routes = await mapWithConcurrency(pending, ROUTE_RESOLUTION_CONCURRENCY, (spec) => resolveSpecRoute(spec, getRoute));

  return pending.map((spec, index) => ({ spec, route: routes[index] }));
}

module.exports = {
  buildOrder,
  buildOrderSpec,
  finalizeOrder,
  resolveSpecRoute,
  generateSimulationOrders,
  generateOrderStream,
  destinationDemandAt,
  SERVICE_AREA_CENTER,
};
