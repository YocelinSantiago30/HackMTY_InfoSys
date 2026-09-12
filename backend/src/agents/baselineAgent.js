// Estrategia simple que un repartidor real podría usar: reglas de umbral
// sobre pago mínimo, pago/minuto, pago/km y distancia máxima (sección 3).
// NO usa batching, análisis de demanda, reposicionamiento ni score compuesto
// — eso es exclusivo de SmartCourier (FASE 13).
//
// Función pura a propósito: no toca la base de datos, así se puede probar
// de forma aislada (sección 58).

const DEFAULTS = {
  minimumPayment: 0,
  minimumPaymentPerMinute: 3,
  minimumPaymentPerKm: 8,
  maximumDistanceKm: 15,
};

function toNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function evaluateBaseline({ order, preferences = {} }) {
  const paymentPerMinute = order.final_payment / order.estimated_time_minutes;
  const paymentPerKm = order.final_payment / order.distance_km;

  const minimumPayment = toNumber(preferences.minimum_payment, DEFAULTS.minimumPayment);
  const minimumPaymentPerMinute = toNumber(
    preferences.minimum_payment_per_minute,
    DEFAULTS.minimumPaymentPerMinute
  );
  const minimumPaymentPerKm = toNumber(
    preferences.minimum_payment_per_km,
    DEFAULTS.minimumPaymentPerKm
  );
  const maximumDistanceKm = toNumber(
    preferences.maximum_distance_km,
    DEFAULTS.maximumDistanceKm
  );

  const reasons = [
    {
      criterion: "finalPayment",
      comparator: ">=",
      value: order.final_payment,
      threshold: minimumPayment,
      passed: order.final_payment >= minimumPayment,
    },
    {
      criterion: "paymentPerMinute",
      comparator: ">=",
      value: Number(paymentPerMinute.toFixed(2)),
      threshold: minimumPaymentPerMinute,
      passed: paymentPerMinute >= minimumPaymentPerMinute,
    },
    {
      criterion: "paymentPerKm",
      comparator: ">=",
      value: Number(paymentPerKm.toFixed(2)),
      threshold: minimumPaymentPerKm,
      passed: paymentPerKm >= minimumPaymentPerKm,
    },
    {
      criterion: "distanceKm",
      comparator: "<=",
      value: order.distance_km,
      threshold: maximumDistanceKm,
      passed: order.distance_km <= maximumDistanceKm,
    },
  ];

  const decision = reasons.every((reason) => reason.passed) ? "ACCEPT" : "REJECT";

  return { decision, reasons };
}

module.exports = {
  evaluateBaseline,
  DEFAULTS,
};
