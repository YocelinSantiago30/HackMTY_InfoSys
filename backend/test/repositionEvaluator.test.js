const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateReposition } = require("../src/agents/repositionEvaluator");
const { ZONES } = require("../src/simulation/zones");

const CUMBRES = ZONES.find((z) => z.name === "Cumbres");
const CENTRO = ZONES.find((z) => z.name === "Centro");
// La zona más aislada (>10km de cualquier otra, ver FASE 23) — es la única
// desde la que "sin mejor opción cercana" es cierto sin importar la hora.
const APODACA = ZONES.find((z) => z.name === "Apodaca");

// Hora sin rush: hay variación real de demanda entre zonas (ver FASE 23).
const NORMAL_HOUR = 8;
// Hora de cena: casi todas las zonas suben a HIGH+, por diseño (rush domina).
const DINNER_RUSH_HOUR = 19;

test("WAIT cuando ya está en una zona de demanda alta", () => {
  const { decision, reasons } = evaluateReposition({
    currentLat: CENTRO.lat,
    currentLng: CENTRO.lng,
    simulatedHour: DINNER_RUSH_HOUR,
    preferences: {},
  });

  assert.equal(decision, "WAIT");
  assert.equal(reasons[0].code, "ALREADY_IN_HIGH_DEMAND_ZONE");
});

test("REPOSITION cuando hay una zona mejor dentro del radio permitido", () => {
  const { decision, impact } = evaluateReposition({
    currentLat: CUMBRES.lat,
    currentLng: CUMBRES.lng,
    simulatedHour: NORMAL_HOUR,
    preferences: {},
  });

  assert.equal(decision, "REPOSITION");
  assert.equal(impact.fromZone, "Cumbres");
  assert.ok(impact.distanceKm > 0);
  assert.ok(impact.travelTimeMinutes > 0);
});

test("WAIT cuando ninguna zona cercana mejora la demanda actual", () => {
  // Apodaca está a más de 10km de cualquier otra zona (17-26km), así que
  // nunca hay una "zona vecina" que evaluar, sin importar la hora.
  const { decision, reasons } = evaluateReposition({
    currentLat: APODACA.lat,
    currentLng: APODACA.lng,
    simulatedHour: NORMAL_HOUR,
    preferences: {},
  });

  assert.equal(decision, "WAIT");
  assert.equal(reasons[0].code, "NO_BETTER_ZONE_NEARBY");
});

test("respeta la zona de trabajo configurada, aunque exista una zona mejor fuera de ella", () => {
  const { decision, reasons } = evaluateReposition({
    currentLat: CUMBRES.lat,
    currentLng: CUMBRES.lng,
    simulatedHour: NORMAL_HOUR,
    preferences: {
      work_zone_center_lat: CUMBRES.lat,
      work_zone_center_lng: CUMBRES.lng,
      work_zone_radius_km: 2,
    },
  });

  assert.equal(decision, "WAIT");
  assert.equal(reasons[0].code, "NO_BETTER_ZONE_NEARBY");
});
