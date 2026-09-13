// Simulador de un turno completo con una política dada. Emite el log de
// eventos de courier/event_log_schema.json y calcula las métricas de la
// tabla de resultados. Las violaciones de seguridad se auditan con lo que
// REALMENTE pasó (shocks incluidos), no con la predicción de la política.
const {
  VEHICLES,
  MANDATORY_BREAK_AFTER_MIN,
  MANDATORY_BREAK_DURATION_MIN,
  HEAT_MAX_CONTINUOUS_MIN,
  REST_RESETS_RIDING_MIN,
} = require("./config");
const { generateShift } = require("./orderStream");
const { toSeconds, toIso, round2, zoneDistanceKm, normalizeShock, activeShocks } = require("./world");
const { planTrip } = require("./trip");
const { evaluateSafety, overlapsHeatWindow } = require("./safety");
const { decide } = require("./fastPath");

const STRATEGY_INTERVAL_SECONDS = 30 * 60;

// Política del agente: tier 1 (fast path) + tier 2 (estrategia) opcional.
function ourAgent({ strategyClient, demandModel }) {
  return {
    name: "OurAgent",
    strategyClient,
    decide: (request, ctx) => decide(request, { ...ctx, demandModel, strategy: strategyClient.current() }).response,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runShift(config, policy, { enforceBreaks = true } = {}) {
  const shift = generateShift(config);
  const cfg = shift.config;
  const profile = VEHICLES[cfg.vehicle];
  const allShocks = shift.shocks.map(normalizeShock).sort((a, b) => a.start - b.start);

  let seq = 0;
  const events = [];
  const emit = (seconds, event) => events.push({ seconds, seq: seq++, event: { ...event, sim_time: event.sim_time ?? toIso(seconds) } });

  const m = {
    offered: 0,
    accepted: 0,
    completed: 0,
    earnings: 0,
    km: 0,
    deadheadKm: 0,
    deadlineMisses: 0,
    safetyViolations: 0,
    violations: [],
    lastCompletion: cfg.startSeconds,
    latencies: [],
    degradedDecisions: 0,
  };
  const courier = { zone: cfg.start_location_zone, busyUntil: cfg.startSeconds, ridingMin: 0, lastActivityEnd: cfg.startSeconds, lastBreakEnd: null };

  emit(cfg.startSeconds, {
    event: "shift_start",
    seed: cfg.seed,
    shift_hours: cfg.shift_hours,
    vehicle: cfg.vehicle,
    start_location_zone: cfg.start_location_zone,
    shift_end_time: cfg.shift_end_time,
    fuel_mxn_per_km: profile.fuelMxnPerKm,
  });

  const strategyContext = (seconds) => ({
    vehicle: cfg.vehicle,
    sim_time: toIso(seconds),
    shift_start_time: cfg.shift_start_time,
    shift_end_time: cfg.shift_end_time,
    earnings_mxn: round2(m.earnings),
    orders_completed: m.completed,
    current_zone: courier.zone,
    active_shocks: activeShocks(allShocks, seconds).map(({ start, end, ...s }) => s),
  });

  const refreshStrategy = async (seconds) => {
    if (!policy.strategyClient) return;
    const s = await policy.strategyClient.refresh(strategyContext(seconds));
    emit(seconds, {
      event: "strategy_update",
      reservation_wage_mxn_hr: s.reservation_wage_mxn_hr,
      target_zone: s.target_zone,
      reasoning: s.reasoning,
      confidence: s.confidence,
      degraded: s.degraded,
    });
  };

  let shockIndex = 0;
  let nextStrategyAt = cfg.startSeconds;
  const advanceStrategyAndShocks = async (until) => {
    for (;;) {
      const nextShock = allShocks[shockIndex];
      const shockAt = nextShock && nextShock.start <= until ? nextShock.start : Infinity;
      const strategyAt = nextStrategyAt <= until ? nextStrategyAt : Infinity;
      if (shockAt === Infinity && strategyAt === Infinity) return;
      if (shockAt <= strategyAt) {
        const { start, end, ...event } = nextShock;
        emit(start, event);
        shockIndex += 1;
        await refreshStrategy(start); // un shock dispara una revisión de estrategia
      } else {
        await refreshStrategy(strategyAt);
        nextStrategyAt += STRATEGY_INTERVAL_SECONDS;
      }
    }
  };

  for (const order of shift.orders) {
    const t = toSeconds(order.sim_time);
    await advanceStrategyAndShocks(t);
    if (t < courier.busyUntil) continue; // ocupado o en descanso: la plataforma no le ofrece

    if (t - courier.lastActivityEnd >= REST_RESETS_RIDING_MIN * 60 && courier.ridingMin > 0) {
      courier.ridingMin = 0;
      courier.lastBreakEnd = toIso(courier.lastActivityEnd + REST_RESETS_RIDING_MIN * 60);
    }

    const pickupKm = zoneDistanceKm(courier.zone, order.zone_pickup);
    if (pickupKm > profile.offerRadiusKm) continue; // fuera del radio de oferta

    const { event, ...orderFields } = order;
    const request = {
      ...orderFields,
      distance_pickup_km: pickupKm,
      courier_state_overrides: {
        continuous_riding_min: round2(courier.ridingMin),
        shift_elapsed_hours: round2((t - cfg.startSeconds) / 3600),
        last_break_end_time: courier.lastBreakEnd,
        shift_end_time: cfg.shift_end_time,
        in_flight_orders: [],
        current_zone: courier.zone,
      },
    };

    m.offered += 1;
    const ctx = { shocks: allShocks.filter((s) => s.start <= t), liveState: null };
    const startedAt = process.hrtime.bigint();
    const result = policy.decide(request, ctx);
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    m.latencies.push(latencyMs);
    if (result.degraded) m.degradedDecisions += 1;

    emit(t, { event: "order_offered", ...request });
    emit(t, { event: "decision", sim_time: order.sim_time, ...result, latency_ms: round2(latencyMs) });
    if (result.decision !== "ACCEPT") continue;

    // Ejecución real: con TODOS los shocks (también los que aún no se conocían).
    m.accepted += 1;
    const trip = planTrip(request, {
      vehicle: cfg.vehicle,
      shocks: allShocks,
      nowSeconds: t,
      courierZone: courier.zone,
      continuousRidingMin: courier.ridingMin,
      inFlight: [],
    });
    const violations = evaluateSafety(trip, { shiftEndSeconds: cfg.endSeconds, vehicle: cfg.vehicle }, 0);
    m.safetyViolations += violations.length;
    violations.forEach((v) => m.violations.push({ order_id: order.order_id, constraint: v.constraint }));

    const arrivePickup = t + trip.pickupMin * 60;
    emit(t, { event: "position_update", zone: courier.zone, status: "to_pickup", order_id: order.order_id });
    if (trip.waitMin > 0) emit(arrivePickup, { event: "position_update", zone: order.zone_pickup, status: "waiting", order_id: order.order_id });
    emit(arrivePickup + trip.waitMin * 60, { event: "position_update", zone: order.zone_pickup, status: "to_dropoff", order_id: order.order_id });

    const gross = Number(request.base_pay_mxn) * Number(request.surge_multiplier) + Number(request.est_tip_mxn || 0);
    m.earnings += gross - trip.km * profile.fuelMxnPerKm;
    m.km += trip.km;
    m.deadheadKm += pickupKm;
    m.completed += 1;
    if (trip.dropoffSeconds > toSeconds(order.delivery_deadline)) m.deadlineMisses += 1;

    courier.ridingMin += trip.totalMin;
    courier.zone = order.zone_dropoff;
    courier.busyUntil = trip.completionSeconds;
    courier.lastActivityEnd = trip.completionSeconds;
    m.lastCompletion = Math.max(m.lastCompletion, trip.completionSeconds);

    emit(trip.completionSeconds, { event: "position_update", zone: courier.zone, status: "idle", order_id: order.order_id });
    const workedHours = Math.max((trip.completionSeconds - cfg.startSeconds) / 3600, 1 / 60);
    emit(trip.completionSeconds, {
      event: "earnings_update",
      earnings_mxn: round2(m.earnings),
      orders_completed: m.completed,
      mxn_per_hr: round2(m.earnings / workedHours),
    });

    // Norma del mundo (igual para todas las políticas): descanso forzado.
    const heatBreak =
      courier.ridingMin >= HEAT_MAX_CONTINUOUS_MIN && overlapsHeatWindow(trip.completionSeconds, trip.completionSeconds + 1);
    if (enforceBreaks && (courier.ridingMin >= MANDATORY_BREAK_AFTER_MIN || heatBreak)) {
      const breakEnd = trip.completionSeconds + MANDATORY_BREAK_DURATION_MIN * 60;
      emit(trip.completionSeconds, { event: "position_update", zone: courier.zone, status: "on_break" });
      emit(breakEnd, { event: "position_update", zone: courier.zone, status: "idle" });
      courier.busyUntil = breakEnd;
      courier.lastActivityEnd = breakEnd;
      courier.ridingMin = 0;
      courier.lastBreakEnd = toIso(breakEnd);
    }
  }

  await advanceStrategyAndShocks(cfg.endSeconds - 1);
  const endSeconds = Math.max(cfg.endSeconds, m.lastCompletion);
  const workedHours = (endSeconds - cfg.startSeconds) / 3600;
  emit(endSeconds, {
    event: "shift_end",
    orders_offered: m.offered,
    orders_completed: m.completed,
    earnings_mxn: round2(m.earnings),
    safety_violations: m.safetyViolations,
  });

  events.sort((a, b) => a.seconds - b.seconds || a.seq - b.seq);
  return {
    config: cfg,
    events: events.map((e) => e.event),
    metrics: {
      earnings_mxn: round2(m.earnings),
      mxn_per_hr: round2(m.earnings / workedHours),
      accept_rate_pct: round2(m.offered ? (100 * m.accepted) / m.offered : 0),
      orders_offered: m.offered,
      orders_completed: m.completed,
      km: round2(m.km),
      deadhead_pct_of_km: round2(m.km ? (100 * m.deadheadKm) / m.km : 0),
      deadline_misses: m.deadlineMisses,
      safety_violations: m.safetyViolations,
      violations: m.violations,
      degraded_decisions: m.degradedDecisions,
      p99_latency_ms: round2([...m.latencies].sort((a, b) => a - b)[Math.floor(0.99 * (m.latencies.length - 1))] || 0),
    },
  };
}

function toJsonl(events) {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

module.exports = {
  runShift,
  ourAgent,
  toJsonl,
  median,
};
