// Reloj en tiempo real + persistencia + sockets alrededor de SimulationCore.
// No decide nada: todo lo que afecta resultados vive en el núcleo.
//
// Recuperación: cada paso (tick, evento o cierre) corre en UNA transacción
// que incluye sus efectos (pedidos, decisiones, cobros) y el snapshot del
// núcleo. Si el proceso muere a mitad de un paso, la transacción se revierte
// y al reanudar se continúa desde el último snapshot confirmado; como el
// núcleo es determinista, el resultado final es el mismo que sin interrupción.
// Los eventos de socket se emiten solo después del commit.
const pool = require("../config/database");
const logger = require("../utils/logger");
const socketBus = require("../socket/socketBus");
const metricsService = require("../services/metrics.service");
const persistence = require("../services/simulationPersistence.service");
const SimulationCore = require("./SimulationCore");

const TICK_INTERVAL_MS = 250;
// 1x = 1 minuto de turno simulado por segundo real.
const SIMULATED_SECONDS_PER_REAL_SECOND = 60;
const VALID_SPEEDS = [1, 2, 5, 10];

const DECISION_EVENTS = { BASELINE: "baseline_decision", SMARTCOURIER: "smart_decision" };

class SimulationEngine {
  constructor({ simulation, preferences, agentIds, onAutoFinish, coreOptions = {} }) {
    this.id = simulation.id;
    this.durationSeconds = simulation.simulation_duration_seconds;
    this.speed = VALID_SPEEDS.includes(simulation.speed_multiplier) ? simulation.speed_multiplier : 1;
    this.agentIds = agentIds;
    this.onAutoFinish = onAutoFinish;
    this.coreOptions = {
      simulationId: simulation.id,
      seed: Number(simulation.seed),
      durationSeconds: simulation.simulation_duration_seconds,
      preferences,
      ...coreOptions,
    };

    this.intervalHandle = null;
    this.queue = Promise.resolve();
    this.tickInFlight = false;
    this.finished = false;
    this.db = pool;
    this.pendingEmits = null;
    this.dirty = true;
    this.metricsDirty = true;
    this.core = new SimulationCore({ ...this.coreOptions, hooks: this.buildHooks() });
  }

  // Simulación nueva: genera la lista única de pedidos y guarda el estado inicial.
  async prepare() {
    await this.core.prepare();
    await persistence.saveRuntime({
      simulationId: this.id,
      simulationOrders: this.core.simulationOrders,
      snapshot: this.core.toSnapshot(),
    });
    this.dirty = false;
  }

  // Simulación existente: continúa exactamente desde el último snapshot confirmado.
  async restore() {
    const runtime = await persistence.loadRuntime(this.id);
    if (!runtime) return false;
    this.core = SimulationCore.fromSnapshot({
      snapshot: runtime.snapshot,
      simulationOrders: runtime.simulation_orders,
      options: { ...this.coreOptions, hooks: this.buildHooks() },
    });
    this.dirty = false;
    this.metricsDirty = true;
    return true;
  }

  // Serializa ticks, eventos inyectados y el cierre: el núcleo nunca se
  // modifica desde dos lugares a la vez.
  runExclusive(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async inTransaction(fn) {
    const client = await pool.connect();
    this.db = client;
    this.pendingEmits = [];

    try {
      await client.query("BEGIN");
      const result = await fn();
      await this.persistState();
      await client.query("COMMIT");

      const emits = this.pendingEmits;
      this.pendingEmits = null;
      emits.forEach(([event, payload]) => socketBus.emitToSimulation(this.id, event, payload));
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      this.pendingEmits = null;
      // La memoria avanzó pero la base no: se vuelve al último estado confirmado.
      this.db = pool;
      await this.restore();
      throw error;
    } finally {
      this.db = pool;
      client.release();
    }
  }

  // Avanza el reloj simulado hasta `targetSecond` como un paso atómico.
  advance(targetSecond) {
    return this.runExclusive(() => this.inTransaction(() => this.core.advanceTo(Math.min(targetSecond, this.durationSeconds))));
  }

  emit(event, payload) {
    const message = [event, { simulationId: this.id, ...payload }];
    if (this.pendingEmits) this.pendingEmits.push(message);
    else socketBus.emitToSimulation(this.id, ...message);
  }

  buildHooks() {
    const touched = () => {
      this.dirty = true;
      this.metricsDirty = true;
    };

    return {
      onOrderReleased: async ({ order }) => {
        touched();
        const saved = await persistence.insertOrder(order, this.db);
        this.emit("new_order", saved);
        return saved;
      },

      onDecision: async (d) => {
        touched();
        await persistence.recordDecision(
          {
            simulationId: this.id,
            agentId: this.agentIds[d.agentCode],
            orderId: d.order?.id ?? null,
            decidedAtSecond: d.second,
            decision: d.decision,
            score: d.score,
            reasons: d.reasons,
            positiveFactors: d.positiveFactors,
            negativeFactors: d.negativeFactors,
            restrictions: d.restrictions,
            estimatedImpact: d.estimatedImpact,
            position: d.position,
          },
          this.db
        );

        if (!d.order) return; // WAIT/REPOSITION ociosos: solo quedan registrados
        this.emit(DECISION_EVENTS[d.agentCode], {
          orderId: d.order.id,
          orderNumber: d.order.external_order_number,
          decision: d.decision,
          score: d.score,
          reasons: d.reasons,
          positiveFactors: d.positiveFactors,
          negativeFactors: d.negativeFactors,
          restrictions: d.restrictions,
          estimatedImpact: d.estimatedImpact,
        });
      },

      onAssignment: async ({ agentCode, orders, batchGroupId, second }) => {
        touched();
        for (const { order, promisedSecond } of orders) {
          await persistence.upsertAssignment(
            {
              orderId: order.id,
              agentId: this.agentIds[agentCode],
              batchGroupId,
              distanceKm: order.distance_km,
              assignedAtSecond: second,
              promisedSecond,
            },
            this.db
          );
        }
      },

      onOrderCompleted: async ({ agentCode, order, second, position, delaySeconds, promisedSecond }) => {
        touched();
        await persistence.markAssignmentCompleted(
          {
            orderId: order.id,
            agentId: this.agentIds[agentCode],
            completedAtSecond: second,
            delaySeconds,
            paidAmount: order.final_payment,
          },
          this.db
        );
        this.emit("order_completed", {
          agentCode,
          orderId: order.id,
          orderNumber: order.external_order_number,
          second,
          position,
          promisedSecond,
          delaySeconds,
        });
      },

      onOrderCancelled: async ({ agentCode, order, second }) => {
        touched();
        this.emit("order_cancelled", { agentCode, orderId: order.id, orderNumber: order.external_order_number, second });
      },

      onRouteChanged: async ({ agentCode, route, position }) => {
        touched();
        this.emit("route_updated", { agentCode, route, position });
      },
    };
  }

  isRunning() {
    return this.intervalHandle !== null;
  }

  start() {
    if (this.isRunning() || this.finished) return;
    this.broadcastState();
    this.intervalHandle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    logger.simulation(`Simulación ${this.id} en marcha a ${this.speed}x`);
  }

  pause() {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  setSpeed(speed) {
    this.speed = speed;
    this.emit("simulation_speed_changed", { speed });
  }

  // Estado completo para clientes que se (re)conectan: rutas activas y posiciones.
  broadcastState() {
    for (const agent of Object.values(this.core.agents)) {
      this.emit("route_updated", {
        agentCode: agent.code,
        route: this.core.routePayload(agent),
        position: agent.position,
      });
    }
  }

  async tick() {
    // Si un tick tarda (p. ej. OSRM lento), el siguiente se omite en lugar de
    // encimarse; el reloj lógico simplemente avanza en el próximo.
    if (this.tickInFlight || this.finished) return;
    this.tickInFlight = true;

    try {
      const step = SIMULATED_SECONDS_PER_REAL_SECOND * this.speed * (TICK_INTERVAL_MS / 1000);
      await this.advance(this.core.clock + step);

      if (this.core.clock >= this.durationSeconds) {
        this.pause();
        await this.onAutoFinish?.(this.id);
      }
    } catch (error) {
      logger.error(`Error en tick de simulación ${this.id}: ${error.message}`);
    } finally {
      this.tickInFlight = false;
    }
  }

  // Dentro de la transacción del paso: contadores, reloj y (si hubo cambios
  // discretos) el snapshot. Entre cambios discretos el movimiento se deriva
  // del reloj, así que un snapshot anterior reproduce el mismo estado.
  async persistState() {
    const snapshot = this.core.snapshot();

    await this.db.query("UPDATE simulation_sessions SET current_simulation_second = $1 WHERE id = $2", [
      Math.round(this.core.clock),
      this.id,
    ]);

    const rows = [];
    for (const agent of Object.values(this.core.agents)) {
      const firstOrderNumber = agent.plan?.stops.find((s) => !s.done && s.orderNumber !== null)?.orderNumber;
      const row = await persistence.persistAgentState(
        {
          simulationId: this.id,
          agentId: this.agentIds[agent.code],
          counters: agent.counters,
          position: agent.position,
          busyUntilSecond: agent.plan?.kind === "DELIVERY" ? agent.plan.endSecond : null,
          activeOrderId: firstOrderNumber ? this.core.orders.get(firstOrderNumber).id : null,
        },
        this.db
      );
      rows.push({ ...row, code: agent.code });
    }

    if (this.dirty) {
      await persistence.saveSnapshot({ simulationId: this.id, snapshot: this.core.toSnapshot() }, this.db);
      this.dirty = false;
    }

    this.emit("simulation_tick", {
      second: snapshot.second,
      durationSeconds: this.durationSeconds,
      speed: this.speed,
      trafficLevel: snapshot.trafficLevel,
      trafficVersion: snapshot.trafficVersion,
      agents: Object.fromEntries(
        Object.entries(snapshot.agents).map(([code, a]) => [code, { lat: a.lat, lng: a.lng, status: a.status }])
      ),
    });

    if (this.metricsDirty) {
      this.metricsDirty = false;
      this.emit("metrics_updated", metricsService.buildComparison(rows, this.core.clock / 60));
    }
  }

  applyEvent(eventType, payload) {
    return this.runExclusive(() =>
      this.inTransaction(async () => {
        const effect = await this.core.applyEvent(eventType, payload);
        this.dirty = true;
        this.metricsDirty = true;
        return effect;
      })
    );
  }

  // Cierre (automático o manual): las entregas en curso se completan igual
  // para ambos agentes y queda persistido el estado final.
  finish() {
    this.pause();
    return this.runExclusive(async () => {
      if (this.finished) return;
      await this.inTransaction(async () => {
        await this.core.finishShift();
        this.dirty = true;
        this.metricsDirty = true;
      });
      this.finished = true;
    });
  }

  get currentSecond() {
    return this.core.clock;
  }
}

module.exports = SimulationEngine;
module.exports.VALID_SPEEDS = VALID_SPEEDS;
