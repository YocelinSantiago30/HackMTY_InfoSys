// Replay de un turno grabado (courier/evaluation_protocol.md §6): vuelve a
// decidir cada `order_offered` del log con el fast path, usando exactamente
// lo que había al momento (shocks anunciados y la estrategia vigente del
// propio log), y compara contra las decisiones grabadas.
const { decide } = require("./fastPath");
const { normalizeShock, toSeconds } = require("./world");
const { BOOTSTRAP_STRATEGY } = require("./strategyClient");

// onExplain (opcional) recibe la explicación completa de cada decisión, para
// poder responder "¿por qué saltaste ese pedido?" sobre un turno grabado.
function replayEvents(events, { demandModel, onExplain = null }) {
  let strategy = { ...BOOTSTRAP_STRATEGY, degraded: true };
  const shocks = [];
  let pending = null;
  const mismatches = [];
  let compared = 0;

  for (const event of events) {
    if (event.event === "shock") shocks.push(normalizeShock(event));
    else if (event.event === "strategy_update") strategy = event;
    else if (event.event === "order_offered") {
      const { event: _, ...request } = event;
      const now = toSeconds(request.sim_time);
      const result = decide(request, { strategy, demandModel, shocks: shocks.filter((s) => s.start <= now) });
      pending = result.response;
      onExplain?.({ ...result.explain, binding_constraint: pending.binding_constraint, tier: pending.tier, degraded: pending.degraded });
    } else if (event.event === "decision" && pending && pending.order_id === event.order_id) {
      compared += 1;
      if (pending.decision !== event.decision || (pending.binding_constraint ?? null) !== (event.binding_constraint ?? null)) {
        mismatches.push({
          order_id: event.order_id,
          recorded: { decision: event.decision, binding_constraint: event.binding_constraint ?? null },
          replayed: { decision: pending.decision, binding_constraint: pending.binding_constraint },
        });
      }
      pending = null;
    }
  }

  return { compared, mismatches, identical: mismatches.length === 0 };
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

module.exports = {
  replayEvents,
  parseJsonl,
};
