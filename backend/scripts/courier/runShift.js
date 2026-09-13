// Graba un turno completo a un log JSONL o reproduce uno grabado.
//
//   node scripts/courier/runShift.js '{"seed":1234,"shift_hours":8,"vehicle":"moto","start_location_zone":7}' --out turno.jsonl
//   node scripts/courier/runShift.js --replay turno.jsonl
//   node scripts/courier/runShift.js --stream '{"seed":1234,...}'     # huella del flujo de pedidos
//
// El tier 2 se consulta en COURIER_MODEL_URL con COURIER_MODEL_API_KEY; si no
// responde, el turno corre igual en modo degradado (y el log lo dice).
require("dotenv").config({ quiet: true });
const fs = require("fs");
const { runShift, ourAgent, toJsonl } = require("../../src/courier/simulator");
const { replayEvents, parseJsonl } = require("../../src/courier/replay");
const { loadDemandModel } = require("../../src/courier/demandModel");
const { generateShift, streamSha256 } = require("../../src/courier/orderStream");
const StrategyClient = require("../../src/courier/strategyClient");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const replayPath = argValue("--replay");
  if (replayPath) {
    const result = replayEvents(parseJsonl(fs.readFileSync(replayPath, "utf8")), { demandModel: loadDemandModel() });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.identical ? 0 : 1);
  }

  const streamConfig = argValue("--stream");
  if (streamConfig) {
    const shift = generateShift(JSON.parse(streamConfig));
    console.log(`${shift.orders.length} pedidos, ${shift.shocks.length} shocks, sha256=${streamSha256(shift)}`);
    return;
  }

  const config = JSON.parse(process.argv[2]);
  const out = argValue("--out") || `shift_seed${config.seed}_${config.vehicle}.jsonl`;
  const shift = await runShift(config, ourAgent({ demandModel: loadDemandModel(), strategyClient: new StrategyClient() }));
  fs.writeFileSync(out, toJsonl(shift.events));
  const { violations, ...metrics } = shift.metrics;
  console.log(JSON.stringify({ log: out, ...metrics }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
