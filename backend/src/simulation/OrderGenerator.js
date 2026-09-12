const { haversineDistanceKm, randomPointInRadius } = require("../utils/geo");
const routingService = require("../services/routing.service");
const { simulatedHourOfDay } = require("./simulatedTime");

const SERVICE_AREA_CENTER = { lat: 25.6866, lng: -100.3161 }; // Monterrey, NL
const SERVICE_AREA_RADIUS_KM = 8;
const MIN_DELIVERY_DISTANCE_KM = 0.8;

// Sección 25: penalización de un cierre vial. No existe un grafo de calles
// real, así que "cerrar una calle" se modela como un factor de desvío
// aplicado uniformemente a la ruta, no a un segmento específico invalidado.
const ROAD_CLOSURE_DETOUR_FACTOR = 1.6;

const URGENT_ORDER_EXPIRATION_SECONDS = 45;
const URGENT_ORDER_PAYMENT_BOOST = 1.3;

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

function trafficLevelForHour(random, hour) {
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 13 && hour <= 15) || (hour >= 18 && hour <= 20);

  if (isRushHour) {
    return pickWeighted(random, [
      { value: "LOW", weight: 1 },
      { value: "MEDIUM", weight: 3 },
      { value: "HIGH", weight: 4 },
      { value: "SEVERE", weight: 2 },
    ]);
  }

  return pickWeighted(random, [
    { value: "LOW", weight: 5 },
    { value: "MEDIUM", weight: 3 },
    { value: "HIGH", weight: 1 },
  ]);
}

function destinationDemandForHour(random, hour) {
  const isLunchRush = hour >= 12 && hour < 14;
  const isDinnerRush = hour >= 18 && hour < 21;

  if (isDinnerRush) {
    return pickWeighted(random, [
      { value: "MEDIUM", weight: 1 },
      { value: "HIGH", weight: 3 },
      { value: "VERY_HIGH", weight: 4 },
    ]);
  }

  if (isLunchRush) {
    return pickWeighted(random, [
      { value: "MEDIUM", weight: 2 },
      { value: "HIGH", weight: 4 },
      { value: "VERY_HIGH", weight: 1 },
    ]);
  }

  return pickWeighted(random, [
    { value: "LOW", weight: 3 },
    { value: "MEDIUM", weight: 4 },
    { value: "HIGH", weight: 1 },
  ]);
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

async function buildOrder({
  random,
  simulationId,
  currentSecond,
  orderNumber,
  modifiers = {},
  forceUrgent = false,
}) {
  const pickup = randomPointInRadius(random, SERVICE_AREA_CENTER, SERVICE_AREA_RADIUS_KM);

  let dropoff;
  do {
    dropoff = randomPointInRadius(random, SERVICE_AREA_CENTER, SERVICE_AREA_RADIUS_KM);
  } while (
    haversineDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) < MIN_DELIVERY_DISTANCE_KM
  );

  const route = await routingService.getRoute({
    originLat: pickup.lat,
    originLng: pickup.lng,
    destinationLat: dropoff.lat,
    destinationLng: dropoff.lng,
  });

  // Sección 26: mientras un evento esté activo (surge/tráfico/demanda
  // inyectados manualmente), reemplaza la heurística normal para los
  // pedidos generados a partir de ese momento.
  if (modifiers.roadClosureActive) {
    route.distanceKm = Number((route.distanceKm * ROAD_CLOSURE_DETOUR_FACTOR).toFixed(3));
    route.durationMinutes = Number((route.durationMinutes * ROAD_CLOSURE_DETOUR_FACTOR).toFixed(2));
    route.source = "ESTIMATED";
  }

  const hour = simulatedHourOfDay(currentSecond);
  const trafficLevel = modifiers.trafficLevel || trafficLevelForHour(random, hour);
  const destinationDemand = modifiers.destinationDemand || destinationDemandForHour(random, hour);
  const surgeMultiplier = modifiers.surgeMultiplier || surgeForDemand(random, destinationDemand);

  const perKmRate = random.nextFloat(9, 14); // $/km, tarifa realista Monterrey
  const flatFee = random.nextFloat(15, 25);
  const basePayment = Number((route.distanceKm * perKmRate + flatFee).toFixed(2));
  const urgentBoost = forceUrgent ? URGENT_ORDER_PAYMENT_BOOST : 1;
  const finalPayment = Number((basePayment * surgeMultiplier * urgentBoost).toFixed(2));

  const { size: packageSize, weight: packageWeight } = packageSizeAndWeight(random);
  const priority = forceUrgent || random.next() < 0.15 ? "HIGH" : "NORMAL";
  const expirationSeconds = forceUrgent
    ? URGENT_ORDER_EXPIRATION_SECONDS
    : random.nextInt(60, 180);

  return {
    simulation_id: simulationId,
    external_order_number: orderNumber,
    merchant_name: random.pick(MERCHANT_NAMES),
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
    dropoff_lat: dropoff.lat,
    dropoff_lng: dropoff.lng,
    base_payment: basePayment,
    surge_multiplier: surgeMultiplier,
    final_payment: finalPayment,
    distance_km: route.distanceKm,
    estimated_time_minutes: route.durationMinutes,
    route_source: route.source,
    traffic_level: trafficLevel,
    destination_demand: destinationDemand,
    priority,
    package_size: packageSize,
    package_weight: packageWeight,
    estimated_preparation_minutes: random.nextInt(5, 20),
    expiration_seconds: expirationSeconds,
    created_at_simulation_second: currentSecond,
  };
}

module.exports = {
  buildOrder,
  SERVICE_AREA_CENTER,
  ROAD_CLOSURE_DETOUR_FACTOR,
};
