require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const fs = require('fs'), path = require('path'), Module = require('module');
const Core = require('../src/simulation/SimulationCore');
const { estimateRoute } = require('../src/services/routing.service');
const { routed } = require('./auditDemo');
const { generateSimulationOrders } = require('../src/simulation/OrderGenerator');
const Random = require('../src/simulation/SimulationRandomService');
const { SCENARIOS } = require('./compareStrategies');
const out = path.resolve(__dirname, '../../output/validation/agent-review');
// Congela exactamente la versión que empataba en la captura, no una versión
// más antigua. Resuelve sus imports desde la misma carpeta del núcleo.
const filename = require.resolve('../src/simulation/SimulationCore');
const previous = new Module(filename, module);
previous.filename = filename; previous.paths = Module._nodeModulePaths(path.dirname(filename));
previous._compile(fs.readFileSync(path.join(out, 'SimulationCore.before.cjs'), 'utf8'), filename);
const Before = previous.exports;
const round = n => Math.round(n * 100) / 100;
async function run(Engine, fixture, getRoute, events = [], options = {}) {
  const decisions = [];
  const core = new Engine({ simulationId: 'reservation-validation', seed: fixture.seed, durationSeconds: 10800,
    preferences: fixture.preferences, getRoute, ...options, hooks: { onDecision: d => decisions.push(d) } });
  core.setSimulationOrders(fixture.orders); core.nextOrderNumber = fixture.orders.at(-1).spec.orderNumber + 1;
  for (const event of events) { await core.advanceTo(event.at); await core.applyEvent(event.type, event.payload); }
  await core.advanceTo(10800); await core.finishShift();
  const metrics = Object.fromEntries(Object.entries(core.agents).map(([code, a]) => [code, {
    ...a.counters, net: round(a.counters.grossEarnings - a.counters.operatingCost),
  }]));
  return { metrics, decisions };
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const real = 'routed' in args || 'demo' in args;
  const getRoute = real ? routed : async p => estimateRoute(p);
  const count = Number(args.count || (real ? 6 : 12));
  const start = Number(args.start || (real ? 161001 : 162001));
  const policies = (args.policies || 'lookahead,score').split(',');
  const rows = [];
  for (let i = 0; i < ('demo' in args ? 1 : count); i++) {
    const fixture = 'demo' in args ? require('../../output/validation/demo-review/fixture.json') : {
      seed: start + i, preferences: { vehicle_type: ['motorcycle', 'bike', 'car'][i % 3] },
      orders: await generateSimulationOrders({ random: new Random(start + i), durationSeconds: 10800, getRoute }),
    };
    for (const [scenario, events] of Object.entries(real ? { normal: [] } : SCENARIOS)) {
      const before = await run(Before, fixture, getRoute, events);
      const variants = {};
      for (const smartPolicy of policies) {
        const after = await run(Core, fixture, getRoute, events, { smartPolicy });
        if (JSON.stringify(before.metrics.BASELINE) !== JSON.stringify(after.metrics.BASELINE)) throw Error('Baseline cambió');
        variants[smartPolicy] = after.metrics.SMARTCOURIER;
        if ('demo' in args) fs.writeFileSync(path.join(out, `demo-${smartPolicy}.json`), JSON.stringify(after, null, 2));
      }
      const row = { seed: fixture.seed, vehicle: fixture.preferences.vehicle_type || 'motorcycle', scenario,
        routeSources: [...new Set(fixture.orders.map(o => o.route.source))], baseline: before.metrics.BASELINE,
        before: before.metrics.SMARTCOURIER, ...variants };
      rows.push(row);
      console.log(JSON.stringify({ seed: row.seed, scenario, baseline: row.baseline.net, before: row.before.net,
        ...Object.fromEntries(policies.map(p => [p, row[p].net])) }));
    }
  }
  const summary = Object.fromEntries(['baseline', 'before', ...policies].map(p => [p, {
    mean: round(rows.reduce((s, r) => s + r[p].net, 0) / rows.length),
    positive: rows.filter(r => r[p].net > 0).length, wins: rows.filter(r => r[p].net > r.baseline.net).length,
    ties: rows.filter(r => r[p].net === r.baseline.net).length,
    late: rows.reduce((s, r) => s + r[p].lateDeliveries, 0),
    completed: rows.reduce((s, r) => s + r[p].completedOrders, 0),
  }]));
  fs.writeFileSync(path.join(out, `${args.output || ('demo' in args ? 'demo-candidates' : real ? 'development-routed' : 'development-estimated')}.json`), JSON.stringify({ runs: rows.length, summary, rows }, null, 2));
  console.log('SUMMARY', JSON.stringify(summary));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { run, Before };
