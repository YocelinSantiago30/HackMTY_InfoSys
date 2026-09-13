// Modelo de demanda por zona y hora, ENTRENADO con los flujos de pedidos de
// las seeds de ajuste (scripts/courier/train.js). Responde, para un
// repartidor libre en una zona a cierta hora: cuántos minutos esperará el
// siguiente pedido que le ofrezcan y cuántos km vacíos recorrerá para
// recogerlo. Es lo que da valor (o costo) al lugar donde termina una entrega.
const fs = require("fs");
const path = require("path");
const { ZONES, VEHICLES } = require("./config");
const { hourOfDay, toSeconds, zoneDistanceKm, round2 } = require("./world");

const MODEL_PATH = path.join(__dirname, "../../../models/courier/demand_model.json");
const MAX_EXPECTED_WAIT_MIN = 60;

function trainDemandModel(shifts) {
  // Pedidos por hora con pickup en cada zona, promediado sobre las horas observadas.
  const counts = Array.from({ length: 24 }, () => Object.fromEntries(ZONES.map((z) => [z.id, 0])));
  const observedHours = Array(24).fill(0);

  for (const shift of shifts) {
    for (let s = shift.config.startSeconds; s < shift.config.endSeconds; s += 3600) {
      observedHours[Math.floor(hourOfDay(s))] += Math.min(1, (shift.config.endSeconds - s) / 3600);
    }
    for (const order of shift.orders) {
      counts[Math.floor(hourOfDay(toSeconds(order.sim_time)))][order.zone_pickup] += 1;
    }
  }

  const ratePerHour = counts.map((byZone, hour) =>
    Object.fromEntries(ZONES.map((z) => [z.id, observedHours[hour] ? byZone[z.id] / observedHours[hour] : 0]))
  );

  const tables = {};
  for (const [vehicle, profile] of Object.entries(VEHICLES)) {
    tables[vehicle] = {};
    for (const from of ZONES) {
      tables[vehicle][from.id] = ratePerHour.map((byZone) => {
        let offers = 0;
        let weightedKm = 0;
        for (const to of ZONES) {
          const km = zoneDistanceKm(from.id, to.id);
          if (km > profile.offerRadiusKm) continue;
          offers += byZone[to.id];
          weightedKm += byZone[to.id] * km;
        }
        return {
          expectedWaitMin: round2(offers > 0 ? Math.min(MAX_EXPECTED_WAIT_MIN, 60 / offers) : MAX_EXPECTED_WAIT_MIN),
          expectedDeadheadKm: round2(offers > 0 ? weightedKm / offers : profile.offerRadiusKm),
        };
      });
    }
  }

  return { version: 1, trainedOnShifts: shifts.length, ratePerHour, tables };
}

let cached = null;

function loadDemandModel() {
  if (!cached) {
    if (!fs.existsSync(MODEL_PATH)) {
      throw new Error(`Falta ${MODEL_PATH}: ejecuta "node scripts/courier/train.js" para entrenar el modelo`);
    }
    cached = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
  }
  return cached;
}

function saveDemandModel(model) {
  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  fs.writeFileSync(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`);
  cached = model;
}

function zoneOutlook(model, vehicle, zoneId, seconds) {
  return model.tables[vehicle][zoneId][Math.floor(hourOfDay(seconds))];
}

module.exports = {
  trainDemandModel,
  loadDemandModel,
  saveDemandModel,
  zoneOutlook,
  MODEL_PATH,
};
