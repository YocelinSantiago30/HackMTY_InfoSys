// ============================================================================
// COURIER — límites de seguridad, perfiles de vehículo y zonas.
// Este es "el archivo donde se define cada límite" (courier/README.md).
// Todo se aplica en código (safety.js); nunca en un prompt de modelo.
// ============================================================================

// --- Reglas de seguridad (courier/evaluation_protocol.md §4) -----------------

// 1. No entregar en zonas marcadas después de las 22:00 (y hasta las 06:00).
const FLAGGED_ZONES = [3, 10];
const FLAGGED_NIGHT_START_HOUR = 22;
const FLAGGED_NIGHT_END_HOUR = 6;

// 2. Descanso obligatorio de 20 minutos después de 4 horas continuas.
const MANDATORY_BREAK_AFTER_MIN = 240;
const MANDATORY_BREAK_DURATION_MIN = 20;

// 3. Calor: entre 12:00 y 16:00 la conducción continua se limita a 90 minutos.
const HEAT_WINDOW_START_HOUR = 12;
const HEAT_WINDOW_END_HOUR = 16;
const HEAT_MAX_CONTINUOUS_MIN = 90;

// 4. Rechazar pedidos que no se completan antes del fin del turno.
//    (el fin de turno SIEMPRE se lee del estado, nunca de aquí)

// 5. Límites de peso y volumen por vehículo: ver VEHICLES.

// Una pausa de al menos esta duración reinicia la conducción continua.
const REST_RESETS_RIDING_MIN = MANDATORY_BREAK_DURATION_MIN;

// Colchón para predicciones de tiempo: una lluvia o un retraso de restaurante
// no deben convertir una aceptación "justa" en una violación.
const SAFETY_MARGIN_MIN = 5;

// --- Vehículos (velocidad, capacidad, costo) --------------------------------
// offerRadiusKm: la plataforma solo ofrece pedidos cuyo pickup está a esta
// distancia del repartidor, por eso dónde termina cada entrega importa.
const VEHICLES = {
  moto: { speedKmh: 28, rainSpeedFactor: 0.75, maxWeightKg: 12, maxVolumeLiters: 45, fuelMxnPerKm: 1.2, offerRadiusKm: 7 },
  car: { speedKmh: 22, rainSpeedFactor: 0.85, maxWeightKg: 40, maxVolumeLiters: 200, fuelMxnPerKm: 2.4, offerRadiusKm: 8 },
  bike: { speedKmh: 14, rainSpeedFactor: 0.8, maxWeightKg: 7, maxVolumeLiters: 25, fuelMxnPerKm: 0, offerRadiusKm: 4 },
};

// Máximo de pedidos simultáneos que el fast path acepta apilar.
const MAX_IN_FLIGHT_ORDERS = 2;

// --- Zonas de Monterrey (id, nombre, centroide, peso de demanda) ------------
const ZONES = [
  { id: 1, name: "Centro", lat: 25.6714, lng: -100.3094, demand: 1.3 },
  { id: 2, name: "Obispado", lat: 25.676, lng: -100.345, demand: 0.9 },
  { id: 3, name: "Independencia", lat: 25.659, lng: -100.314, demand: 0.6 },
  { id: 4, name: "Contry", lat: 25.642, lng: -100.278, demand: 0.8 },
  { id: 5, name: "San Pedro Valle", lat: 25.651, lng: -100.362, demand: 1.4 },
  { id: 6, name: "Cumbres", lat: 25.73, lng: -100.39, demand: 1.0 },
  { id: 7, name: "Mitras Centro", lat: 25.695, lng: -100.35, demand: 0.9 },
  { id: 8, name: "San Nicolás", lat: 25.742, lng: -100.3, demand: 1.1 },
  { id: 9, name: "Guadalupe", lat: 25.677, lng: -100.256, demand: 0.9 },
  { id: 10, name: "Apodaca", lat: 25.781, lng: -100.189, demand: 0.5 },
  { id: 11, name: "Santa Catarina", lat: 25.673, lng: -100.458, demand: 0.6 },
  { id: 12, name: "Distrito Tec", lat: 25.651, lng: -100.289, demand: 1.2 },
];

const STREET_FACTOR = 1.35;
const INTRA_ZONE_KM = 1.2;
// Un tramo que entra o sale de una zona cerrada toma un desvío.
const CLOSURE_DETOUR_FACTOR = 1.4;

// --- Plataforma --------------------------------------------------------------
const DECISION_WINDOW_SECONDS = 5;
const DELIVERY_PROMISE_SLACK_MIN = 20;
const PLATFORMS = ["rappi", "didi", "uber"];
const DEFAULT_SHIFT_DATE = "2026-03-21";
const DEFAULT_SHIFT_START = "15:00:00";

module.exports = {
  FLAGGED_ZONES,
  FLAGGED_NIGHT_START_HOUR,
  FLAGGED_NIGHT_END_HOUR,
  MANDATORY_BREAK_AFTER_MIN,
  MANDATORY_BREAK_DURATION_MIN,
  HEAT_WINDOW_START_HOUR,
  HEAT_WINDOW_END_HOUR,
  HEAT_MAX_CONTINUOUS_MIN,
  REST_RESETS_RIDING_MIN,
  SAFETY_MARGIN_MIN,
  VEHICLES,
  MAX_IN_FLIGHT_ORDERS,
  ZONES,
  STREET_FACTOR,
  INTRA_ZONE_KM,
  CLOSURE_DETOUR_FACTOR,
  DECISION_WINDOW_SECONDS,
  DELIVERY_PROMISE_SLACK_MIN,
  PLATFORMS,
  DEFAULT_SHIFT_DATE,
  DEFAULT_SHIFT_START,
};
