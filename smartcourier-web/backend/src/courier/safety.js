// Las 5 restricciones de seguridad (courier/evaluation_protocol.md §4),
// aplicadas en código. Los límites viven en config.js.
//
// La misma función sirve para:
// - el fast path, con la PREDICCIÓN del viaje y un margen (SAFETY_MARGIN_MIN);
// - el simulador, con lo que REALMENTE pasó y margen 0, para contar violaciones.
// El pago nunca entra aquí: una negativa por seguridad no cambia aunque suba el pago.
const {
  FLAGGED_ZONES,
  FLAGGED_NIGHT_START_HOUR,
  FLAGGED_NIGHT_END_HOUR,
  MANDATORY_BREAK_AFTER_MIN,
  MANDATORY_BREAK_DURATION_MIN,
  HEAT_WINDOW_START_HOUR,
  HEAT_WINDOW_END_HOUR,
  HEAT_MAX_CONTINUOUS_MIN,
  VEHICLES,
} = require("./config");
const { hourOfDay, toIso, round2 } = require("./world");

function hhmm(seconds) {
  return toIso(seconds).slice(11, 16);
}

function inFlaggedNight(seconds) {
  const hour = hourOfDay(seconds);
  return hour >= FLAGGED_NIGHT_START_HOUR || hour < FLAGGED_NIGHT_END_HOUR;
}

// ¿Hay algún instante de [from, to) dentro de la ventana de calor de algún día?
function overlapsHeatWindow(from, to) {
  if (to <= from) return false;
  const dayStart = Math.floor(from / 86400) * 86400;
  for (let day = dayStart - 86400; day <= to; day += 86400) {
    const windowStart = day + HEAT_WINDOW_START_HOUR * 3600;
    const windowEnd = day + HEAT_WINDOW_END_HOUR * 3600;
    if (from < windowEnd && to > windowStart) return true;
  }
  return false;
}

// trip: { startSeconds, dropoffSeconds (entrega de ESTE pedido), completionSeconds
//         (fin de todo lo que lleva), continuousRidingStartMin, loadWeightKg, loadVolumeLiters,
//         zoneDropoff }
// state: { shiftEndSeconds, vehicle }
// Devuelve la lista de restricciones que el viaje violaría, en orden de precedencia.
function evaluateSafety(trip, state, marginMin = 0) {
  const profile = VEHICLES[state.vehicle];
  const margin = marginMin * 60;
  const violations = [];

  if (trip.loadWeightKg > profile.maxWeightKg || trip.loadVolumeLiters > profile.maxVolumeLiters) {
    const overWeight = trip.loadWeightKg > profile.maxWeightKg;
    violations.push({
      constraint: "vehicle_capacity",
      reason: overWeight
        ? `Carga de ${round2(trip.loadWeightKg)} kg supera el límite de ${profile.maxWeightKg} kg para ${state.vehicle}.`
        : `Volumen de ${round2(trip.loadVolumeLiters)} L supera el límite de ${profile.maxVolumeLiters} L para ${state.vehicle}.`,
    });
  }

  if (FLAGGED_ZONES.includes(Number(trip.zoneDropoff)) && inFlaggedNight(trip.dropoffSeconds + margin)) {
    violations.push({
      constraint: "flagged_zone_night",
      reason: `La entrega sería a las ${hhmm(trip.dropoffSeconds)} en zona ${trip.zoneDropoff}, marcada: prohibido entregar ahí después de las ${FLAGGED_NIGHT_START_HOUR}:00.`,
    });
  }

  if (trip.completionSeconds + margin > state.shiftEndSeconds) {
    violations.push({
      constraint: "shift_end_infeasible",
      reason: `Terminaría a las ${hhmm(trip.completionSeconds)}; el turno acaba a las ${hhmm(state.shiftEndSeconds)} y no alcanza a completarse.`,
    });
  }

  const activeMin = (trip.completionSeconds - trip.startSeconds) / 60;
  const ridingAtEnd = trip.continuousRidingStartMin + activeMin;
  if (ridingAtEnd + marginMin > MANDATORY_BREAK_AFTER_MIN) {
    violations.push({
      constraint: "mandatory_break",
      reason: `Llevaría ${Math.round(ridingAtEnd)} min conduciendo sin parar; tras ${MANDATORY_BREAK_AFTER_MIN / 60} h toca descanso obligatorio de ${MANDATORY_BREAK_DURATION_MIN} min.`,
    });
  }

  // Desde qué instante se superarían los 90 min continuos, y si eso cae en 12–16 h.
  const exceedsAt = trip.startSeconds + (HEAT_MAX_CONTINUOUS_MIN - marginMin - trip.continuousRidingStartMin) * 60;
  if (ridingAtEnd + marginMin > HEAT_MAX_CONTINUOUS_MIN && overlapsHeatWindow(Math.max(exceedsAt, trip.startSeconds), trip.completionSeconds + margin)) {
    violations.push({
      constraint: "heat_rule",
      reason: `Regla de calor: entre ${HEAT_WINDOW_START_HOUR}:00 y ${HEAT_WINDOW_END_HOUR}:00 la conducción continua se limita a ${HEAT_MAX_CONTINUOUS_MIN} min; llegaría a ${Math.round(ridingAtEnd)} min.`,
    });
  }

  return violations;
}

module.exports = {
  evaluateSafety,
  overlapsHeatWindow,
  inFlaggedNight,
};
