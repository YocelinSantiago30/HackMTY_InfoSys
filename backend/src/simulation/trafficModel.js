// Tráfico GLOBAL y versionado. Antes cada pedido traía su propio nivel de
// tráfico aleatorio y los eventos solo afectaban tramos calculados después;
// ahora hay una sola condición vigente para toda la ciudad:
// - un calendario por franjas de 30 min generado desde la seed;
// - encima, los eventos (tráfico pesado, cierre vial).
// Cada cambio efectivo incrementa `version`, y SimulationCore re-temporiza
// todas las rutas activas con la nueva condición.
const SimulationRandomService = require("./SimulationRandomService");
const { simulatedHourOfDay } = require("./simulatedTime");
const { ROAD_CLOSURE_DETOUR_FACTOR } = require("./economics");

const SLOT_SECONDS = 30 * 60;
const TRAFFIC_SEED_SALT = 0x5bd1e995;

function isRushHour(hour) {
  return (hour >= 7 && hour <= 9) || (hour >= 13 && hour <= 15) || (hour >= 18 && hour <= 20);
}

function pickWeighted(random, options) {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = random.next() * total;
  for (const option of options) {
    if (roll < option.weight) return option.value;
    roll -= option.weight;
  }
  return options[options.length - 1].value;
}

function sampleLevelForHour(random, hour) {
  return isRushHour(hour)
    ? pickWeighted(random, [
        { value: "LOW", weight: 1 },
        { value: "MEDIUM", weight: 3 },
        { value: "HIGH", weight: 4 },
        { value: "SEVERE", weight: 2 },
      ])
    : pickWeighted(random, [
        { value: "LOW", weight: 5 },
        { value: "MEDIUM", weight: 3 },
        { value: "HIGH", weight: 1 },
      ]);
}

// Nivel más probable por hora: lo que un repartidor puede anticipar sin
// conocer el tráfico real futuro (lo usan las simulaciones de SmartCourier).
function expectedLevelForHour(hour) {
  return isRushHour(hour) ? "HIGH" : "LOW";
}

class TrafficModel {
  constructor({ schedule, overrideLevel = null, roadClosureActive = false, version = 0, appliedKey = null }) {
    this.schedule = schedule;
    this.overrideLevel = overrideLevel;
    this.roadClosureActive = roadClosureActive;
    this.version = version;
    this.appliedKey = appliedKey ?? this.key(0);
  }

  static generate({ seed, durationSeconds }) {
    const random = new SimulationRandomService((seed ^ TRAFFIC_SEED_SALT) >>> 0);
    const schedule = [];
    // Una franja extra cubre las entregas que terminan después del turno.
    for (let second = 0; second <= durationSeconds + SLOT_SECONDS; second += SLOT_SECONDS) {
      schedule.push(sampleLevelForHour(random, simulatedHourOfDay(second)));
    }
    return new TrafficModel({ schedule });
  }

  static fromJSON(json) {
    return new TrafficModel(json);
  }

  // Pronóstico desde `second`: el evento vigente se asume persistente y el
  // resto del día sigue el patrón típico por hora (no el calendario real).
  forecastFrom(second) {
    const schedule = this.schedule.map((_, index) => expectedLevelForHour(simulatedHourOfDay(index * SLOT_SECONDS)));
    const forecast = new TrafficModel({
      schedule,
      overrideLevel: this.overrideLevel,
      roadClosureActive: this.roadClosureActive,
      version: this.version,
    });
    forecast.appliedKey = forecast.key(second);
    return forecast;
  }

  // Nivel que se puede anticipar para `second` estando en `nowSecond`: la
  // franja actual se conoce; las siguientes usan el evento vigente (si hay)
  // o el patrón típico por hora.
  forecastLevelAt(second, nowSecond) {
    if (Math.floor(second / SLOT_SECONDS) === Math.floor(nowSecond / SLOT_SECONDS)) return this.levelAt(nowSecond);
    return this.overrideLevel || expectedLevelForHour(simulatedHourOfDay(second));
  }

  levelAt(second) {
    if (this.overrideLevel) return this.overrideLevel;
    const index = Math.min(Math.floor(second / SLOT_SECONDS), this.schedule.length - 1);
    return this.schedule[Math.max(0, index)];
  }

  key(second) {
    return `${this.levelAt(second)}|${this.roadClosureActive}`;
  }

  conditions() {
    return {
      level: this.appliedKey.split("|")[0],
      detourFactor: this.roadClosureActive ? ROAD_CLOSURE_DETOUR_FACTOR : 1,
      version: this.version,
    };
  }

  nextSlotBoundaryAfter(second) {
    return (Math.floor(second / SLOT_SECONDS) + 1) * SLOT_SECONDS;
  }

  // Devuelve true si la condición efectiva cambió (nueva versión).
  refresh(second) {
    const key = this.key(second);
    if (key === this.appliedKey) return false;
    this.appliedKey = key;
    this.version += 1;
    return true;
  }

  setOverride(level, second) {
    this.overrideLevel = level;
    return this.refresh(second);
  }

  setRoadClosure(active, second) {
    this.roadClosureActive = active;
    return this.refresh(second);
  }

  toJSON() {
    return {
      schedule: this.schedule,
      overrideLevel: this.overrideLevel,
      roadClosureActive: this.roadClosureActive,
      version: this.version,
      appliedKey: this.appliedKey,
    };
  }
}

module.exports = TrafficModel;
module.exports.SLOT_SECONDS = SLOT_SECONDS;
