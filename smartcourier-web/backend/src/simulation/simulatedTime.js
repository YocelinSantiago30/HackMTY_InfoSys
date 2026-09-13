// El turno simulado arranca al mediodía; no depende de la hora real del
// sistema, para que la seed siga siendo la única fuente de variación
// (sección 21: demanda/tráfico heurísticos por hora del día).
const SHIFT_START_HOUR = 12;

function simulatedHourOfDay(currentSecond) {
  const elapsedHours = currentSecond / 3600;
  return Math.floor(SHIFT_START_HOUR + elapsedHours) % 24;
}

module.exports = {
  simulatedHourOfDay,
};
