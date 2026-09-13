// El turno simulado arranca a las 12:00 (backend/src/simulation/simulatedTime.js).
const SHIFT_START_HOUR = 12;

export function formatShiftClock(second) {
  const totalMinutes = SHIFT_START_HOUR * 60 + Math.floor(second / 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
