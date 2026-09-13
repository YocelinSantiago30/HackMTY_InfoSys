// Conjuntos de configuraciones DISJUNTOS (courier/evaluation_protocol.md §8):
// - TUNING: se usan para entrenar el modelo de demanda y ajustar parámetros.
// - REPORTING: nunca se usan para ajustar; de aquí salen los resultados.
// Varían seed, vehículo, duración, hora de inicio y zona inicial.
const VEHICLE_ORDER = ["moto", "car", "bike"];
const SHIFT_HOURS = [4, 6, 8];
const START_TIMES = ["10:00:00", "15:00:00", "18:00:00"];

function configsFor(seeds) {
  return seeds.map((seed, index) => ({
    seed,
    shift_hours: SHIFT_HOURS[Math.floor(index / 3) % 3],
    vehicle: VEHICLE_ORDER[index % 3],
    start_location_zone: ((seed * 7) % 12) + 1,
    shift_start_time: `2026-03-21T${START_TIMES[Math.floor(index / 9) % 3]}`,
  }));
}

const TUNING_SEEDS = Array.from({ length: 54 }, (_, i) => i + 1); // 1–54
const REPORTING_SEEDS = Array.from({ length: 30 }, (_, i) => 90001 + i); // 90001–90030

module.exports = {
  TUNING_SEEDS,
  REPORTING_SEEDS,
  TUNING_CONFIGS: configsFor(TUNING_SEEDS),
  REPORTING_CONFIGS: configsFor(REPORTING_SEEDS),
  configsFor,
};
