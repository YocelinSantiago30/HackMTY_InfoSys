// Tiempo simulado, distancias entre zonas y efecto de los shocks. Funciones
// puras: nunca se usa el reloj del sistema (el replay debe ser idéntico).
const { haversineDistanceKm } = require("../utils/geo");
const {
  ZONES,
  STREET_FACTOR,
  INTRA_ZONE_KM,
  CLOSURE_DETOUR_FACTOR,
  VEHICLES,
} = require("./config");

// --- tiempo: "YYYY-MM-DDTHH:MM:SS" <-> segundos (sin zona horaria) ----------

function toSeconds(iso) {
  const [date, time = "00:00:00"] = iso.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, Math.floor(s)) / 1000;
}

function toIso(seconds) {
  return new Date(Math.round(seconds) * 1000).toISOString().slice(0, 19);
}

function hourOfDay(seconds) {
  return (((seconds / 3600) % 24) + 24) % 24;
}

const round2 = (value) => Math.round(value * 100) / 100;

// --- espacio -----------------------------------------------------------------

const zoneById = new Map(ZONES.map((z) => [z.id, z]));

function zone(id) {
  const found = zoneById.get(Number(id));
  if (!found) throw new Error(`Zona desconocida: ${id}`);
  return found;
}

function zoneDistanceKm(fromId, toId) {
  if (Number(fromId) === Number(toId)) return INTRA_ZONE_KM;
  const a = zone(fromId);
  const b = zone(toId);
  return round2(haversineDistanceKm(a.lat, a.lng, b.lat, b.lng) * STREET_FACTOR);
}

// --- shocks --------------------------------------------------------------------
// shock: { shock_type, start (s), end (s | null), zone?, multiplier?, order_id?, slip_min? }

function shockActive(shock, seconds) {
  return shock.start <= seconds && (shock.end === null || seconds < shock.end);
}

function activeShocks(shocks, seconds) {
  return shocks.filter((s) => shockActive(s, seconds));
}

function isRaining(shocks, seconds) {
  return shocks.some((s) => s.shock_type === "rain" && shockActive(s, seconds));
}

function zoneSurge(shocks, zoneId, seconds) {
  return shocks
    .filter((s) => s.shock_type === "surge" && Number(s.zone) === Number(zoneId) && shockActive(s, seconds))
    .reduce((product, s) => product * (Number(s.multiplier) || 1), 1);
}

function prepSlipMinutes(shocks, orderId) {
  return shocks
    .filter((s) => s.shock_type === "delay" && s.order_id === orderId)
    .reduce((sum, s) => sum + (Number(s.slip_min) || 0), 0);
}

// Minutos para recorrer `km` saliendo en `seconds`, según vehículo y shocks.
function travelMinutes({ km, vehicle, seconds, shocks = [], fromZone = null, toZone = null }) {
  const profile = VEHICLES[vehicle];
  const speed = profile.speedKmh * (isRaining(shocks, seconds) ? profile.rainSpeedFactor : 1);
  const closed = shocks.some(
    (s) =>
      s.shock_type === "closure" &&
      shockActive(s, seconds) &&
      (Number(s.zone) === Number(fromZone) || Number(s.zone) === Number(toZone))
  );
  return ((km * (closed ? CLOSURE_DETOUR_FACTOR : 1)) / speed) * 60;
}

// Convierte un evento `shock` del log (sim_time, duration_min) a forma interna.
function normalizeShock(event) {
  const start = toSeconds(event.sim_time);
  const end = event.duration_min ? start + Number(event.duration_min) * 60 : null;
  return { ...event, start, end };
}

module.exports = {
  toSeconds,
  toIso,
  hourOfDay,
  round2,
  zone,
  zoneDistanceKm,
  activeShocks,
  isRaining,
  zoneSurge,
  prepSlipMinutes,
  travelMinutes,
  normalizeShock,
};
