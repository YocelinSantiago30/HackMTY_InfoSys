const pool = require("../config/database");
const logger = require("../utils/logger");
const SimulationRandomService = require("./SimulationRandomService");
const { buildOrder, ROAD_CLOSURE_DETOUR_FACTOR } = require("./OrderGenerator");
const orderService = require("../services/order.service");
const agentEvaluationService = require("../services/agentEvaluation.service");
const userService = require("../services/user.service");
const socketBus = require("../socket/socketBus");
const { evaluateSmartCourier } = require("../agents/smartCourierAgent");

const TICK_INTERVAL_MS = 1000;

// Sección 16: nuevos pedidos cada 8-20 segundos simulados.
const MIN_ORDER_INTERVAL_SECONDS = 8;
const MAX_ORDER_INTERVAL_SECONDS = 20;

// Sección 22: cada cuánto se evalúa si SmartCourier (libre) debería
// reposicionarse en vez de esperar donde está.
const IDLE_CHECK_INTERVAL_SECONDS = 30;

// Responsable del tiempo de una simulación en ejecución y de disparar la
// generación de pedidos. No conoce nada de HTTP ni de la UI (sección 19:
// "deberá poder ejecutarse independientemente de la UI").
class SimulationEngine {
  constructor({
    id,
    userId,
    seed,
    durationSeconds,
    currentSecond = 0,
    initialOrderNumber = 0,
    onAutoFinish,
  }) {
    this.id = id;
    this.userId = userId;
    this.seed = seed;
    this.durationSeconds = durationSeconds;
    this.currentSecond = currentSecond;
    this.random = new SimulationRandomService(seed);
    this.onAutoFinish = onAutoFinish;
    this.intervalHandle = null;

    this.orderCounter = initialOrderNumber;
    this.isGeneratingOrder = false;
    this.nextOrderAtSecond =
      currentSecond + this.random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);

    this.isCheckingIdle = false;
    this.nextIdleCheckAtSecond = currentSecond + IDLE_CHECK_INTERVAL_SECONDS;

    // Sección 26: estado en memoria que los eventos dinámicos modifican.
    // OrderGenerator lo consulta al construir pedidos NUEVOS — no existe una
    // cola de ofertas pendientes que un evento pueda "tocar" retroactivamente,
    // así que el efecto aplica a partir del momento en que ocurre el evento.
    this.eventModifiers = {
      surgeMultiplier: null,
      trafficLevel: null,
      destinationDemand: null,
      roadClosureActive: false,
    };
  }

  isRunning() {
    return this.intervalHandle !== null;
  }

  start() {
    if (this.isRunning()) return;

    this.intervalHandle = setInterval(() => {
      this.tick().catch((error) => {
        logger.error(`Error en tick de simulación ${this.id}: ${error.message}`);
      });
    }, TICK_INTERVAL_MS);

    logger.simulation(`Simulación ${this.id} iniciada (seed=${this.seed})`);
  }

  pause() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.simulation(`Simulación ${this.id} pausada en el segundo ${this.currentSecond}`);
    }
  }

  async tick() {
    this.currentSecond += 1;

    await pool.query(
      "UPDATE simulation_sessions SET current_simulation_second = $1 WHERE id = $2",
      [this.currentSecond, this.id]
    );

    if (this.durationSeconds && this.currentSecond >= this.durationSeconds) {
      this.pause();
      if (this.onAutoFinish) {
        await this.onAutoFinish(this.id);
      }
      return;
    }

    if (this.currentSecond >= this.nextOrderAtSecond && !this.isGeneratingOrder) {
      this.nextOrderAtSecond =
        this.currentSecond +
        this.random.nextInt(MIN_ORDER_INTERVAL_SECONDS, MAX_ORDER_INTERVAL_SECONDS);

      // No se espera aquí a propósito: generar un pedido llama a OSRM y
      // puede tardar varios segundos (hasta el timeout de 5s); el reloj de
      // la simulación no debe congelarse mientras tanto.
      this.generateOrder();
    }

    if (this.currentSecond >= this.nextIdleCheckAtSecond && !this.isCheckingIdle) {
      this.nextIdleCheckAtSecond = this.currentSecond + IDLE_CHECK_INTERVAL_SECONDS;
      this.checkIdleRepositioning();
    }
  }

  async checkIdleRepositioning() {
    this.isCheckingIdle = true;

    try {
      await agentEvaluationService.evaluateIdleRepositioning({
        simulationId: this.id,
        userId: this.userId,
        currentSecond: this.currentSecond,
      });
    } catch (error) {
      logger.error(`Error evaluando reposicionamiento en simulación ${this.id}: ${error.message}`);
    } finally {
      this.isCheckingIdle = false;
    }
  }

  async generateOrder({ forceUrgent = false } = {}) {
    this.isGeneratingOrder = true;

    try {
      this.orderCounter += 1;

      const orderData = await buildOrder({
        random: this.random,
        simulationId: this.id,
        currentSecond: this.currentSecond,
        orderNumber: this.orderCounter,
        modifiers: this.eventModifiers,
        forceUrgent,
      });

      const saved = await orderService.insertOrder(orderData);

      logger.simulation(
        `Pedido #${saved.external_order_number} generado en simulación ${this.id} ` +
          `($${saved.final_payment}, ${saved.distance_km} km, ${saved.traffic_level})`
      );

      socketBus.emitToSimulation(this.id, "new_order", saved);

      await agentEvaluationService.evaluateOrderWithBaseline({
        simulationId: this.id,
        userId: this.userId,
        order: saved,
      });

      await agentEvaluationService.evaluateOrderWithSmartCourier({
        simulationId: this.id,
        userId: this.userId,
        order: saved,
        simulation: { simulation_duration_seconds: this.durationSeconds },
      });
    } catch (error) {
      logger.error(`No se pudo generar un pedido en simulación ${this.id}: ${error.message}`);
    } finally {
      this.isGeneratingOrder = false;
    }
  }

  // Aplica el efecto real de un evento inyectado (sección 26). El registro
  // en simulation_events lo hace event.service — aquí solo el efecto sobre
  // el estado vivo de la simulación.
  async applyEvent(eventType, payload = {}) {
    switch (eventType) {
      case "SURGE_STARTED":
        this.eventModifiers.surgeMultiplier = payload.multiplier || 1.5;
        return { surgeMultiplier: this.eventModifiers.surgeMultiplier };

      case "SURGE_ENDED":
        this.eventModifiers.surgeMultiplier = null;
        return {};

      case "TRAFFIC_INCREASED":
        this.eventModifiers.trafficLevel = payload.level || "SEVERE";
        return { trafficLevel: this.eventModifiers.trafficLevel };

      case "TRAFFIC_DECREASED":
        this.eventModifiers.trafficLevel = null;
        return {};

      case "HIGH_DEMAND":
        this.eventModifiers.destinationDemand = "VERY_HIGH";
        return { destinationDemand: "VERY_HIGH" };

      case "LOW_DEMAND":
        this.eventModifiers.destinationDemand = "LOW";
        return { destinationDemand: "LOW" };

      case "ROAD_CLOSED":
        this.eventModifiers.roadClosureActive = true;
        return this.recalculateActiveOrderForSmartCourier();

      case "ROAD_REOPENED":
        this.eventModifiers.roadClosureActive = false;
        return {};

      case "ORDER_CANCELLED":
        return this.cancelActiveOrderForSmartCourier();

      case "URGENT_ORDER":
        if (this.isGeneratingOrder) {
          return { skipped: true, reason: "ya se está generando un pedido" };
        }
        this.generateOrder({ forceUrgent: true });
        return { triggered: true };

      default:
        return {};
    }
  }

  async getSmartCourierAgentId() {
    const result = await pool.query("SELECT id FROM agents WHERE code = 'SMARTCOURIER'");
    return result.rows[0]?.id || null;
  }

  async getActiveOrderForSmartCourier(agentId) {
    const stateResult = await pool.query(
      "SELECT active_order_id, busy_until_simulation_second FROM agent_states WHERE simulation_id = $1 AND agent_id = $2",
      [this.id, agentId]
    );
    const state = stateResult.rows[0];

    if (
      !state?.active_order_id ||
      !state.busy_until_simulation_second ||
      state.busy_until_simulation_second <= this.currentSecond
    ) {
      return null;
    }

    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [state.active_order_id]);
    return orderResult.rows[0] || null;
  }

  // Sección 25: un cierre vial recalcula la ruta del pedido activo y
  // reconsidera si SmartCourier seguiría tomando la misma decisión. No
  // revierte automáticamente ganancias/contadores si la decisión cambia
  // —eso requeriría un mecanismo de reversión económica que no existe—;
  // el antes/después queda registrado para el Decision Inspector.
  async recalculateActiveOrderForSmartCourier() {
    const agentId = await this.getSmartCourierAgentId();
    if (!agentId) return {};

    const order = await this.getActiveOrderForSmartCourier(agentId);
    if (!order) {
      return { message: "SmartCourier no tiene un pedido activo en este momento" };
    }

    const lastDecisionResult = await pool.query(
      `SELECT decision FROM agent_decisions
       WHERE simulation_id = $1 AND agent_id = $2 AND order_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [this.id, agentId, order.id]
    );
    const decisionBeforeEvent = lastDecisionResult.rows[0]?.decision || "ACCEPT";

    const newDistanceKm = Number((order.distance_km * ROAD_CLOSURE_DETOUR_FACTOR).toFixed(3));
    const newTimeMinutes = Number((order.estimated_time_minutes * ROAD_CLOSURE_DETOUR_FACTOR).toFixed(2));

    await pool.query(
      "UPDATE orders SET distance_km = $2, estimated_time_minutes = $3, route_source = 'ESTIMATED' WHERE id = $1",
      [order.id, newDistanceKm, newTimeMinutes]
    );

    const updatedOrder = {
      ...order,
      distance_km: newDistanceKm,
      estimated_time_minutes: newTimeMinutes,
      route_source: "ESTIMATED",
    };

    const preferences = await userService.getPreferences(this.userId);
    const rescored = evaluateSmartCourier({
      order: updatedOrder,
      preferences,
      simulation: { simulation_duration_seconds: this.durationSeconds },
    });

    await pool.query(
      `INSERT INTO agent_decisions
         (simulation_id, agent_id, order_id, decision, score, reasons, positive_factors, negative_factors, restrictions, estimated_impact, decided_at_simulation_second)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        this.id,
        agentId,
        order.id,
        rescored.decision,
        rescored.score,
        JSON.stringify([...rescored.positiveFactors, ...rescored.negativeFactors]),
        JSON.stringify(rescored.positiveFactors),
        JSON.stringify(rescored.negativeFactors),
        JSON.stringify(rescored.restrictions),
        JSON.stringify({
          reason: "ROAD_CLOSED",
          decisionBeforeEvent,
          decisionAfterEvent: rescored.decision,
          newDistanceKm,
          newTimeMinutes,
        }),
        this.currentSecond,
      ]
    );

    logger.smart(
      `Cierre vial: pedido #${order.external_order_number} recalculado, ` +
        `${decisionBeforeEvent} -> ${rescored.decision}`
    );

    return {
      orderId: order.id,
      orderNumber: order.external_order_number,
      decisionBeforeEvent,
      decisionAfterEvent: rescored.decision,
      newDistanceKm,
      newTimeMinutes,
    };
  }

  // Sección 26 (ORDER_CANCELLED): cancela de verdad el pedido activo de
  // SmartCourier — revierte lo que applyAcceptance había acreditado.
  async cancelActiveOrderForSmartCourier() {
    const agentId = await this.getSmartCourierAgentId();
    if (!agentId) return {};

    const order = await this.getActiveOrderForSmartCourier(agentId);
    if (!order) {
      return { message: "SmartCourier no tiene un pedido activo para cancelar" };
    }

    await pool.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [order.id]);

    const updated = await pool.query(
      `UPDATE agent_states
       SET accepted_orders = accepted_orders - 1,
           completed_orders = completed_orders - 1,
           earnings = earnings - $3,
           cancelled_orders = cancelled_orders + 1,
           active_order_id = NULL,
           busy_until_simulation_second = NULL,
           updated_at = now()
       WHERE simulation_id = $1 AND agent_id = $2
       RETURNING *`,
      [this.id, agentId, order.final_payment]
    );

    await pool.query(
      `INSERT INTO agent_decisions
         (simulation_id, agent_id, order_id, decision, estimated_impact, decided_at_simulation_second)
       VALUES ($1, $2, $3, 'REJECT', $4, $5)`,
      [
        this.id,
        agentId,
        order.id,
        JSON.stringify({ reason: "ORDER_CANCELLED_BY_EVENT", refundedEarnings: order.final_payment }),
        this.currentSecond,
      ]
    );

    socketBus.emitToSimulation(this.id, "metrics_updated", { agentId, agentState: updated.rows[0] });

    logger.smart(
      `Pedido #${order.external_order_number} cancelado por evento (se revierte $${order.final_payment})`
    );

    return {
      orderId: order.id,
      orderNumber: order.external_order_number,
      refundedEarnings: order.final_payment,
    };
  }
}

module.exports = SimulationEngine;
