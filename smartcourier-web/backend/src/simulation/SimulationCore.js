// Núcleo de la simulación, sin base de datos ni sockets (esos viven en
// SimulationEngine a través de `hooks`). Garantiza una comparación justa:
// - una sola lista de pedidos (simulationOrders) para ambos agentes;
// - misma ubicación inicial, mismo vehículo, mismas rutas y mismos costos;
// - un repartidor solo puede estar en un lugar: mientras entrega, está ocupado;
// - un solo tráfico para toda la ciudad: si cambia, se re-temporizan las
//   rutas activas de TODOS los agentes.
//
// El reloj es lógico: cada evento se procesa en su segundo simulado exacto,
// sin importar cuántos segundos avance cada tick (la velocidad de la demo no
// altera ningún cálculo). Todo el estado es JSON (toSnapshot/fromSnapshot)
// para poder recuperar la simulación tras un reinicio.
const crypto = require("crypto");
const SimulationRandomService = require("./SimulationRandomService");
const TrafficModel = require("./trafficModel");
const {
  buildOrderSpec,
  finalizeOrder,
  generateSimulationOrders,
  destinationDemandAt,
  SERVICE_AREA_CENTER,
} = require("./OrderGenerator");
const { buildTimeline, positionAt, bestSequence, remainingLeg } = require("./routePlanner");
const { simulatedHourOfDay } = require("./simulatedTime");
const {
  vehicleProfile,
  vehicleTrafficFactor,
  baseLegFromRoute,
  effectiveLeg,
  offerEconomics,
  round2,
} = require("./economics");
const { evaluateBaseline } = require("../agents/baselineAgent");
const { evaluateSmartCourier, DEFAULT_THRESHOLDS } = require("../agents/smartCourierAgent");
const { evaluateBatch, DEFAULT_BATCH_LIMITS } = require("../agents/batchEvaluator");
const { evaluateReservation } = require("../agents/reservationEvaluator");
const { evaluateReposition } = require("../agents/repositionEvaluator");
const { compareAcceptVsWait, DEFAULT_LOOKAHEAD } = require("../agents/lookaheadPlanner");
const routingService = require("../services/routing.service");

const AGENT_CODES = ["BASELINE", "SMARTCOURIER"];
const REPOSITION_CHECK_INTERVAL_SECONDS = 10 * 60;
const URGENT_SEED_SALT = 0x9e3779b9;
// Entregar más de 1 minuto después de la hora comprometida cuenta como tarde.
const LATE_TOLERANCE_SECONDS = 60;
const SNAPSHOT_VERSION = 2;

function emptyCounters() {
  return {
    grossEarnings: 0,
    operatingCost: 0,
    distanceKm: 0,
    activeMinutes: 0,
    acceptedOrders: 0,
    rejectedOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    batchedOrders: 0,
    repositions: 0,
    lateDeliveries: 0,
    totalDelayMinutes: 0,
    totalEtaErrorMinutes: 0,
    overtimeMinutes: 0,
  };
}

function pickupStop(order) {
  return {
    type: "PICKUP",
    orderNumber: order.external_order_number,
    lat: Number(order.pickup_lat),
    lng: Number(order.pickup_lng),
    readySecond: order.created_at_simulation_second + Number(order.estimated_preparation_minutes) * 60,
  };
}

function dropoffStop(order) {
  return {
    type: "DROPOFF",
    orderNumber: order.external_order_number,
    lat: Number(order.dropoff_lat),
    lng: Number(order.dropoff_lng),
  };
}

// Copia sin tiempos ni estado, para planear de nuevo una parada pendiente.
function freshStop({ type, orderNumber, lat, lng, readySecond }) {
  return { type, orderNumber, lat, lng, readySecond };
}

function isBusy(agent) {
  return agent.plan?.kind === "DELIVERY";
}

// Mismo pedido + mismo agente → mismo id de grupo: reprocesar un tick tras
// una falla escribe exactamente la misma fila.
function deterministicUuid(text) {
  const h = crypto.createHash("sha1").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

class SimulationCore {
  constructor({
    simulationId,
    seed,
    durationSeconds,
    preferences = {},
    getRoute = routingService.getRoute,
    hooks = {},
    agentCodes = AGENT_CODES,
    // "lookahead": decide aceptar vs esperar simulando escenarios (agente real).
    // "score": solo puntaje (política usada DENTRO de esas simulaciones).
    smartPolicy = "lookahead",
    lookahead = DEFAULT_LOOKAHEAD,
    smartThresholds = DEFAULT_THRESHOLDS,
    batchLimits = DEFAULT_BATCH_LIMITS,
    // Medido con scripts/compareStrategies.js: reposicionarse cuesta más km de
    // lo que ahorra en trayectos a pickups, así que por defecto no se hace.
    enableRepositioning = false,
    // "forecast": la hora comprometida anticipa el tráfico de las próximas
    // franjas; "current": asume que el tráfico actual se mantiene.
    promiseMethod = "forecast",
  }) {
    this.simulationId = simulationId;
    this.seed = seed;
    this.durationSeconds = durationSeconds;
    this.preferences = preferences;
    this.getRoute = getRoute;
    this.hooks = hooks;
    this.agentCodes = agentCodes;
    this.smartPolicy = smartPolicy;
    this.lookaheadConfig = lookahead;
    this.smartThresholds = smartThresholds;
    this.batchLimits = batchLimits;
    this.enableRepositioning = enableRepositioning;
    this.promiseMethod = promiseMethod;
    this.profile = vehicleProfile(preferences);
    this.costPerKm = this.profile.costPerKm;

    this.clock = 0;
    this.simulationOrders = [];
    this.scheduledGeometry = new Map();
    this.nextOrderIndex = 0;
    this.nextOrderNumber = 1;
    this.orders = new Map(); // orderNumber -> fila del pedido publicado
    this.deliveryLegs = new Map(); // orderNumber -> tramo base pickup→destino
    this.urgentGeometry = {}; // orderNumber -> coordenadas (pedidos fuera de la lista)
    this.urgentRandom = new SimulationRandomService((seed ^ URGENT_SEED_SALT) >>> 0);
    this.nextRepositionCheck = REPOSITION_CHECK_INTERVAL_SECONDS;
    this.modifiers = { surgeMultiplier: null, destinationDemand: null };
    this.traffic = TrafficModel.generate({ seed, durationSeconds });

    this.agents = {};
    for (const code of agentCodes) {
      this.agents[code] = {
        code,
        position: { ...SERVICE_AREA_CENTER },
        plan: null,
        counters: emptyCounters(),
        commitments: {}, // orderNumber -> { promisedSecond, acceptedSecond }
      };
    }
  }

  async prepare() {
    this.setSimulationOrders(
      await generateSimulationOrders({
        random: new SimulationRandomService(this.seed),
        durationSeconds: this.durationSeconds,
        getRoute: this.getRoute,
      })
    );
    const lastScheduled = this.simulationOrders[this.simulationOrders.length - 1];
    this.nextOrderNumber = (lastScheduled?.spec.orderNumber ?? 0) + 1;
  }

  setSimulationOrders(simulationOrders) {
    this.simulationOrders = simulationOrders;
    this.scheduledGeometry = new Map(simulationOrders.map((e) => [e.spec.orderNumber, e.route.geometry?.coordinates]));
  }

  // ------------------------------------------------------------ snapshot

  toSnapshot() {
    const agents = {};
    for (const agent of Object.values(this.agents)) {
      agents[agent.code] = {
        position: agent.position,
        plan: agent.plan,
        counters: agent.counters,
        commitments: agent.commitments,
      };
    }

    return JSON.parse(
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        clock: this.clock,
        nextOrderIndex: this.nextOrderIndex,
        nextOrderNumber: this.nextOrderNumber,
        nextRepositionCheck: this.nextRepositionCheck,
        modifiers: this.modifiers,
        traffic: this.traffic.toJSON(),
        urgentRandomState: this.urgentRandom.state,
        orders: [...this.orders.values()],
        deliveryLegs: [...this.deliveryLegs.entries()],
        urgentGeometry: this.urgentGeometry,
        agents,
      })
    );
  }

  static fromSnapshot({ snapshot, simulationOrders, options }) {
    const core = new SimulationCore(options);
    const state = JSON.parse(JSON.stringify(snapshot));

    core.setSimulationOrders(simulationOrders);
    core.clock = state.clock;
    core.nextOrderIndex = state.nextOrderIndex;
    core.nextOrderNumber = state.nextOrderNumber;
    core.nextRepositionCheck = state.nextRepositionCheck;
    core.modifiers = state.modifiers;
    core.traffic = TrafficModel.fromJSON(state.traffic);
    core.urgentRandom.state = state.urgentRandomState;
    core.orders = new Map(state.orders.map((o) => [o.external_order_number, o]));
    core.deliveryLegs = new Map(state.deliveryLegs);
    core.urgentGeometry = state.urgentGeometry;

    for (const code of core.agentCodes) {
      if (state.agents[code]) Object.assign(core.agents[code], state.agents[code]);
    }
    return core;
  }

  // ---------------------------------------------------------------- reloj

  async advanceTo(targetSecond) {
    const target = Math.min(targetSecond, this.durationSeconds);

    for (;;) {
      const candidates = [];
      const nextOrder = this.simulationOrders[this.nextOrderIndex];
      if (nextOrder && nextOrder.spec.releaseSecond <= target) candidates.push(nextOrder.spec.releaseSecond);
      for (const agent of Object.values(this.agents)) {
        if (agent.plan && agent.plan.endSecond <= target) candidates.push(agent.plan.endSecond);
      }
      const trafficBoundary = this.traffic.nextSlotBoundaryAfter(this.clock);
      if (trafficBoundary <= target) candidates.push(trafficBoundary);
      if (this.enableRepositioning && this.nextRepositionCheck <= target) candidates.push(this.nextRepositionCheck);

      if (candidates.length === 0) {
        await this.settleAll(target);
        this.clock = Math.max(this.clock, target);
        return;
      }

      const eventSecond = Math.max(this.clock, Math.min(...candidates));
      await this.settleAll(eventSecond);
      this.clock = eventSecond;

      // Primero el tráfico: los pedidos que se publiquen en este segundo ya
      // nacen con la condición nueva.
      if (this.traffic.refresh(eventSecond)) await this.retimeAll();

      while (
        this.simulationOrders[this.nextOrderIndex] &&
        this.simulationOrders[this.nextOrderIndex].spec.releaseSecond <= eventSecond
      ) {
        const entry = this.simulationOrders[this.nextOrderIndex++];
        await this.releaseOrder(entry);
      }

      if (this.enableRepositioning && this.nextRepositionCheck <= eventSecond) {
        this.nextRepositionCheck = eventSecond + REPOSITION_CHECK_INTERVAL_SECONDS;
        await this.checkRepositioning(eventSecond);
      }
    }
  }

  // Cierre del turno en el segundo actual: ya no llegan pedidos; las
  // entregas en curso se terminan (se cobran y se pagan sus km) igual para
  // ambos agentes, y ese tiempo cuenta como horas extra trabajadas.
  async finishShift() {
    await this.settleAll(this.clock);

    for (const agent of Object.values(this.agents)) {
      if (isBusy(agent)) {
        agent.counters.overtimeMinutes += Math.max(0, agent.plan.endSecond - this.clock) / 60;
        const events = [];
        this.settle(agent, agent.plan.endSecond, events);
        await this.dispatch(events);
      } else if (agent.plan) {
        agent.plan = null;
        await this.hooks.onRouteChanged?.({ agentCode: agent.code, route: null, position: agent.position, second: this.clock });
      }
    }
  }

  // ------------------------------------------------------------- física

  conditions() {
    return this.traffic.conditions();
  }

  async settleAll(second) {
    const events = [];
    for (const agent of Object.values(this.agents)) this.settle(agent, second, events);
    await this.dispatch(events);
  }

  settle(agent, second, events) {
    const plan = agent.plan;
    if (!plan) return;

    for (const leg of plan.legs) {
      if (leg.fromSecond > second) break;
      const duration = leg.toSecond - leg.fromSecond;
      const fraction = duration > 0 ? Math.min(1, (second - leg.fromSecond) / duration) : 1;
      const traveledKm = leg.distanceKm * fraction;
      const delta = traveledKm - leg.accruedKm;
      if (delta > 0) {
        agent.counters.distanceKm += delta;
        agent.counters.operatingCost += delta * this.costPerKm;
        leg.accruedKm = traveledKm;
      }
    }

    if (plan.kind === "DELIVERY") {
      const until = Math.min(second, plan.endSecond);
      if (until > plan.activeAccruedUntil) {
        agent.counters.activeMinutes += (until - plan.activeAccruedUntil) / 60;
        plan.activeAccruedUntil = until;
      }
    }

    let progressed = false;
    for (const stop of plan.stops) {
      if (stop.done) continue;
      const reached = stop.type === "PICKUP" ? stop.departSecond <= second : stop.arriveSecond <= second;
      if (!reached) break;

      stop.done = true;
      progressed = true;
      if (stop.type === "DROPOFF") this.completeDelivery(agent, stop, events);
    }

    if (second >= plan.endSecond) {
      const last = plan.stops[plan.stops.length - 1];
      agent.position = { lat: last.lat, lng: last.lng };
      agent.plan = null;
      events.push({
        second: plan.endSecond,
        hook: "onRouteChanged",
        payload: { agentCode: agent.code, route: null, position: agent.position },
      });
    } else {
      agent.position = positionAt(plan, second);
      if (progressed) {
        events.push({
          second,
          hook: "onRouteChanged",
          payload: { agentCode: agent.code, route: this.routePayload(agent, second), position: agent.position },
        });
      }
    }
  }

  completeDelivery(agent, stop, events) {
    const order = this.orders.get(stop.orderNumber);
    const commitment = agent.commitments[stop.orderNumber];
    const delaySeconds = commitment ? stop.arriveSecond - commitment.promisedSecond : 0;
    const counters = agent.counters;

    counters.grossEarnings += Number(order.final_payment);
    counters.completedOrders += 1;
    counters.totalDelayMinutes += Math.max(0, delaySeconds) / 60;
    counters.totalEtaErrorMinutes += Math.abs(delaySeconds) / 60;
    if (delaySeconds > LATE_TOLERANCE_SECONDS) counters.lateDeliveries += 1;
    delete agent.commitments[stop.orderNumber];

    events.push({
      second: stop.arriveSecond,
      hook: "onOrderCompleted",
      payload: {
        agentCode: agent.code,
        order,
        position: { lat: stop.lat, lng: stop.lng },
        promisedSecond: commitment?.promisedSecond ?? null,
        delaySeconds,
      },
    });
  }

  async dispatch(events) {
    events.sort((a, b) => a.second - b.second);
    for (const event of events) {
      await this.hooks[event.hook]?.({ ...event.payload, second: event.second });
    }
  }

  deliveryBaseLeg(orderNumber) {
    const coordinates = this.scheduledGeometry.get(orderNumber) ?? this.urgentGeometry[orderNumber];
    return { ...this.deliveryLegs.get(orderNumber), coordinates };
  }

  async legBetween(from, stop) {
    const isOwnDelivery = stop.type === "DROPOFF" && from.type === "PICKUP" && from.orderNumber === stop.orderNumber;
    const base = isOwnDelivery
      ? this.deliveryBaseLeg(stop.orderNumber)
      : baseLegFromRoute(
          await this.getRoute({ originLat: from.lat, originLng: from.lng, destinationLat: stop.lat, destinationLng: stop.lng }),
          this.profile
        );
    return effectiveLeg(base, this.conditions(), this.profile);
  }

  estimateLeg(from, stop) {
    const route = routingService.estimateRoute({
      originLat: from.lat,
      originLng: from.lng,
      destinationLat: stop.lat,
      destinationLng: stop.lng,
    });
    return effectiveLeg(baseLegFromRoute(route, this.profile), this.conditions(), this.profile);
  }

  async buildPlan(agent, stops, startSecond, kind) {
    const legs = [];
    let previous = agent.position;
    for (const stop of stops) {
      legs.push(await this.legBetween(previous, stop));
      previous = stop;
    }

    const timeline = buildTimeline({ startSecond, start: agent.position, stops, legs });
    return { ...timeline, kind, activeAccruedUntil: startSecond,
      displayCoordinates: timeline.legs.flatMap(leg => leg.coordinates),
      displayStops: stops.map(stop => ({ ...stop })),
    };
  }

  // La misma ruta (mismas paradas y geometría) con los tiempos de la
  // condición de tráfico vigente. Lo ya recorrido quedó cobrado en settle().
  retimePlan(agent) {
    const plan = agent.plan;
    const second = this.clock;
    const conditions = this.conditions();
    const stops = [];
    const legs = [];

    plan.stops.forEach((stop, index) => {
      if (stop.done) return;
      const leg = plan.legs[index];
      let base;
      if (leg.toSecond <= second) {
        base = { baseDistanceKm: 0, baseDurationMinutes: 0, coordinates: null }; // ya está en la parada
      } else if (leg.fromSecond < second) {
        base = remainingLeg(leg, second);
      } else {
        base = { baseDistanceKm: leg.baseDistanceKm, baseDurationMinutes: leg.baseDurationMinutes, coordinates: leg.coordinates };
      }
      legs.push(effectiveLeg(base, conditions, this.profile));
      stops.push(freshStop(stop));
    });

    const timeline = buildTimeline({ startSecond: second, start: agent.position, stops, legs });
    agent.plan = { ...timeline, kind: plan.kind, activeAccruedUntil: second,
      displayCoordinates: plan.displayCoordinates || plan.legs.flatMap(leg => leg.coordinates),
      displayStops: plan.displayStops || plan.stops,
    };
  }

  async retimeAll() {
    const retimed = [];
    for (const agent of Object.values(this.agents)) {
      if (!agent.plan) continue;
      this.retimePlan(agent);
      retimed.push(agent.code);
      await this.hooks.onRouteChanged?.({
        agentCode: agent.code,
        route: this.routePayload(agent, this.clock),
        position: agent.position,
        second: this.clock,
      });
    }
    return retimed;
  }

  // ------------------------------------------------------------ pedidos

  async releaseOrder({ spec, route }) {
    const row = finalizeOrder({
      spec,
      route,
      simulationId: this.simulationId,
      modifiers: this.modifiers,
      conditions: this.conditions(),
      profile: this.profile,
    });
    const saved = (await this.hooks.onOrderReleased?.({ order: row, second: spec.releaseSecond })) || {
      ...row,
      id: `local-${spec.orderNumber}`,
    };

    const { coordinates, ...base } = baseLegFromRoute(route, this.profile);
    this.deliveryLegs.set(spec.orderNumber, base);
    if (!this.scheduledGeometry.has(spec.orderNumber)) this.urgentGeometry[spec.orderNumber] = coordinates;
    this.orders.set(spec.orderNumber, saved);

    if (this.agents.BASELINE) await this.decideBaseline(saved);
    if (this.agents.SMARTCOURIER) await this.decideSmartCourier(saved);
    return saved;
  }

  async recordDecision(agent, order, result) {
    await this.hooks.onDecision?.({
      agentCode: agent.code,
      order,
      second: this.clock,
      position: { ...agent.position },
      reasons: [],
      positiveFactors: [],
      negativeFactors: [],
      restrictions: [],
      estimatedImpact: {},
      score: null,
      ...result,
    });
  }

  // Hora comprometida de un pedido dentro de un plan. Es la misma para ambos
  // agentes (la promete la plataforma al asignar), se calcula una vez y no
  // cambia aunque después la ruta se re-temporice.
  promisedDropoffSecond(plan, orderNumber) {
    if (this.promiseMethod === "current") {
      return plan.stops.find((s) => s.type === "DROPOFF" && s.orderNumber === orderNumber).arriveSecond;
    }

    const detour = this.conditions().detourFactor;
    let clock = plan.startSecond;
    for (let i = 0; i < plan.stops.length; i++) {
      const leg = plan.legs[i];
      const stop = plan.stops[i];
      const level = this.traffic.forecastLevelAt(clock, this.clock);
      clock += Math.round(leg.baseDurationMinutes * detour * vehicleTrafficFactor(level, this.profile) * 60);
      if (stop.type === "PICKUP") clock = Math.max(clock, stop.readySecond ?? clock);
      if (stop.type === "DROPOFF" && stop.orderNumber === orderNumber) return clock;
    }
    return plan.endSecond;
  }

  async assign(agent, plan, newOrder, { batchGroupId = null, promisedSecond = null } = {}) {
    const second = this.clock;
    agent.plan = plan;
    agent.commitments[newOrder.external_order_number] = {
      promisedSecond: promisedSecond ?? this.promisedDropoffSecond(plan, newOrder.external_order_number),
      acceptedSecond: second,
    };

    const orderNumbers = [...new Set(plan.stops.filter((s) => !s.done && s.orderNumber !== null).map((s) => s.orderNumber))];
    await this.hooks.onAssignment?.({
      agentCode: agent.code,
      orders: orderNumbers.map((n) => ({ order: this.orders.get(n), promisedSecond: agent.commitments[n].promisedSecond })),
      batchGroupId,
      second,
    });
    await this.hooks.onRouteChanged?.({
      agentCode: agent.code,
      route: this.routePayload(agent, second),
      position: agent.position,
      second,
    });
  }

  async decideBaseline(order) {
    const agent = this.agents.BASELINE;

    // Baseline vive la misma física: si va entregando, no puede tomar otro.
    if (isBusy(agent)) {
      agent.counters.rejectedOrders += 1;
      await this.recordDecision(agent, order, {
        decision: "REJECT",
        restrictions: [{ code: "AGENT_BUSY", message: "El repartidor sigue ocupado con otro pedido" }],
      });
      return;
    }

    const { decision, reasons } = evaluateBaseline({ order, preferences: this.preferences });
    // La economía real se calcula también al rechazar, solo para explicar
    // qué habría pasado; Baseline no la usa para decidir.
    const plan = await this.buildPlan(agent, [pickupStop(order), dropoffStop(order)], this.clock, "DELIVERY");
    const estimatedImpact = offerEconomics({ timeline: plan, payment: order.final_payment, costPerKm: this.costPerKm });
    const result = {
      decision,
      reasons,
      positiveFactors: reasons.filter((r) => r.passed),
      negativeFactors: reasons.filter((r) => !r.passed),
      estimatedImpact,
    };

    if (decision === "ACCEPT") {
      agent.counters.acceptedOrders += 1;
      await this.recordDecision(agent, order, result);
      await this.assign(agent, plan, order);
    } else {
      agent.counters.rejectedOrders += 1;
      await this.recordDecision(agent, order, result);
    }
  }

  async decideSmartCourier(order) {
    const agent = this.agents.SMARTCOURIER;
    if (isBusy(agent)) {
      await this.tryBatch(agent, order);
      return;
    }

    const plan = await this.buildPlan(agent, [pickupStop(order), dropoffStop(order)], this.clock, "DELIVERY");
    const arrival = plan.stops[1].arriveSecond;
    const metrics = {
      ...offerEconomics({ timeline: plan, payment: order.final_payment, costPerKm: this.costPerKm }),
      destinationDemandAtArrival:
        this.modifiers.destinationDemand ||
        destinationDemandAt(Number(order.dropoff_lat), Number(order.dropoff_lng), simulatedHourOfDay(arrival)),
    };

    const input = { order, metrics, preferences: this.preferences, thresholds: this.smartThresholds };
    let result = evaluateSmartCourier(input);

    if (this.smartPolicy === "lookahead" && result.decision !== "REJECT") {
      const lookahead = await compareAcceptVsWait({ core: this, order, acceptPlan: plan, config: this.lookaheadConfig });
      result = evaluateSmartCourier({ ...input, lookahead });
    }

    const reasons = [...result.positiveFactors, ...result.negativeFactors];
    if (result.decision === "ACCEPT") {
      agent.counters.acceptedOrders += 1;
      await this.recordDecision(agent, order, { ...result, reasons });
      await this.assign(agent, plan, order);
    } else {
      agent.counters.rejectedOrders += 1;
      await this.recordDecision(agent, order, { ...result, reasons });
    }
  }

  async tryBatch(agent, order) {
    const second = this.clock;
    const remainingStops = agent.plan.stops.filter((stop) => !stop.done).map(freshStop);
    const activeOrders = [...new Set(remainingStops.map((s) => s.orderNumber))].map((n) => this.orders.get(n));
    // Primero intenta asegurar la siguiente entrega manteniendo intactas las
    // paradas, tiempos, kilómetros cobrados y geometría de la entrega en curso.
    // Nunca reserva una tercera ni encadena una nueva fuera del turno.
    if (activeOrders.length === 1) {
      const current = agent.plan;
      const lastStop = current.stops.at(-1);
      const tail = await this.buildPlan({ position: lastStop }, [pickupStop(order), dropoffStop(order)], current.endSecond, "DELIVERY");
      const reservation = evaluateReservation({ order, activeOrders, current, tail,
        durationSeconds: this.durationSeconds, costPerKm: this.costPerKm,
        preferences: this.preferences, limits: this.batchLimits });
      if (reservation.compatible) {
        const plan = { ...current, endSecond: tail.endSecond, totalKm: current.totalKm + tail.totalKm,
          legs: [...current.legs, ...tail.legs], stops: [...current.stops, ...tail.stops],
          displayCoordinates: [...(current.displayCoordinates || current.legs.flatMap(l => l.coordinates)), ...tail.displayCoordinates],
          displayStops: [...(current.displayStops || current.stops), ...tail.displayStops] };
        agent.counters.acceptedOrders += 1;
        agent.counters.batchedOrders += 1;
        await this.recordDecision(agent, order, { decision: "BATCH", estimatedImpact: reservation.impact });
        await this.assign(agent, plan, order, {
          batchGroupId: deterministicUuid(`${this.simulationId}:${agent.code}:${order.external_order_number}`),
          promisedSecond: this.promisedDropoffSecond(tail, order.external_order_number),
        });
        return;
      }
    }
    const promises = Object.fromEntries(
      activeOrders.map((o) => [o.external_order_number, agent.commitments[o.external_order_number].promisedSecond])
    );

    const sequence = bestSequence({
      startSecond: second,
      start: agent.position,
      stops: [...remainingStops, pickupStop(order), dropoffStop(order)],
      estimateLeg: (from, stop) => this.estimateLeg(from, stop),
      promises,
      toleranceSeconds: this.batchLimits.promiseToleranceMinutes * 60,
    });
    const candidatePlan = sequence ? await this.buildPlan(agent, sequence, second, "DELIVERY") : null;
    // El costo de continuar es el de la ruta YA asignada. Volver a pedir
    // una ruta desde la posición móvil alteraba artificialmente la referencia
    // de un batch y generaba consultas de navegación innecesarias.
    const current = {
      endSecond: agent.plan.endSecond,
      remainingKm: agent.plan.legs.reduce((sum, leg) => sum + Math.max(0, leg.distanceKm - leg.accruedKm), 0),
      dropoffSeconds: Object.fromEntries(agent.plan.stops.filter(s => !s.done && s.type === "DROPOFF").map(s => [s.orderNumber, s.arriveSecond])),
    };

    const summary = (plan) => ({
      endSecond: plan.endSecond,
      remainingKm: plan.totalKm,
      dropoffSeconds: Object.fromEntries(plan.stops.filter((s) => s.type === "DROPOFF").map((s) => [s.orderNumber, s.arriveSecond])),
    });

    const result = evaluateBatch({
      newOrder: order,
      activeOrders,
      current,
      candidate: candidatePlan ? summary(candidatePlan) : null,
      promises,
      costPerKm: this.costPerKm,
      preferences: this.preferences,
      limits: this.batchLimits,
    });

    if (!result.compatible) {
      agent.counters.rejectedOrders += 1;
      await this.recordDecision(agent, order, {
        decision: "REJECT",
        restrictions: [{ code: "AGENT_BUSY", message: "El repartidor sigue ocupado con otro pedido" }, ...result.restrictions],
        estimatedImpact: result.impact,
      });
      return;
    }

    agent.counters.acceptedOrders += 1;
    agent.counters.batchedOrders += 1;
    await this.recordDecision(agent, order, { decision: "BATCH", estimatedImpact: result.impact });
    await this.assign(agent, candidatePlan, order, {
      batchGroupId: deterministicUuid(`${this.simulationId}:${agent.code}:${order.external_order_number}`),
    });
  }

  async checkRepositioning(second) {
    const agent = this.agents.SMARTCOURIER;
    if (!agent || agent.plan) return;

    const { decision, reasons, impact } = evaluateReposition({
      currentLat: agent.position.lat,
      currentLng: agent.position.lng,
      simulatedHour: simulatedHourOfDay(second),
      preferences: this.preferences,
    });

    await this.recordDecision(agent, null, { decision, reasons, estimatedImpact: impact });
    if (decision !== "REPOSITION") return;

    agent.counters.repositions += 1;
    agent.plan = await this.buildPlan(
      agent,
      [{ type: "REPOSITION", orderNumber: null, lat: impact.toLat, lng: impact.toLng }],
      second,
      "REPOSITION"
    );
    await this.hooks.onRouteChanged?.({ agentCode: agent.code, route: this.routePayload(agent, second), position: agent.position, second });
  }

  // ------------------------------------------------------------- eventos

  async applyEvent(eventType, payload = {}) {
    await this.settleAll(this.clock);

    const trafficChange = async (changed) => ({
      trafficVersion: this.traffic.version,
      trafficLevel: this.conditions().level,
      retimedAgents: changed ? await this.retimeAll() : [],
    });

    switch (eventType) {
      case "SURGE_STARTED":
        this.modifiers.surgeMultiplier = Number(payload.multiplier) || 1.5;
        return { surgeMultiplier: this.modifiers.surgeMultiplier };
      case "SURGE_ENDED":
        this.modifiers.surgeMultiplier = null;
        return {};
      case "HIGH_DEMAND":
        this.modifiers.destinationDemand = "VERY_HIGH";
        return { destinationDemand: "VERY_HIGH" };
      case "LOW_DEMAND":
        this.modifiers.destinationDemand = "LOW";
        return { destinationDemand: "LOW" };
      case "TRAFFIC_INCREASED":
        return trafficChange(this.traffic.setOverride(payload.level || "SEVERE", this.clock));
      case "TRAFFIC_DECREASED":
        return trafficChange(this.traffic.setOverride(null, this.clock));
      case "ROAD_CLOSED":
        return trafficChange(this.traffic.setRoadClosure(true, this.clock));
      case "ROAD_REOPENED":
        return trafficChange(this.traffic.setRoadClosure(false, this.clock));
      case "URGENT_ORDER":
        return this.releaseUrgentOrder();
      case "ORDER_CANCELLED":
        return this.cancelNewestPendingOrder();
      default:
        return {};
    }
  }

  async releaseUrgentOrder() {
    const spec = buildOrderSpec({
      random: this.urgentRandom,
      releaseSecond: this.clock,
      orderNumber: this.nextOrderNumber++,
      forceUrgent: true,
    });
    const route = await this.getRoute({
      originLat: spec.pickup.lat,
      originLng: spec.pickup.lng,
      destinationLat: spec.dropoff.lat,
      destinationLng: spec.dropoff.lng,
    });
    const order = await this.releaseOrder({ spec, route });
    return { orderNumber: order.external_order_number };
  }

  // Cancela el pedido más reciente que algún agente aún no recoge. Aplica a
  // TODOS los agentes que lo tengan en ruta: el mismo evento, el mismo efecto.
  async cancelNewestPendingOrder() {
    const holders = (orderNumber) =>
      Object.values(this.agents).filter((agent) =>
        agent.plan?.stops.some((s) => s.type === "PICKUP" && !s.done && s.orderNumber === orderNumber)
      );

    const target = [...this.orders.values()].reverse().find((o) => holders(o.external_order_number).length > 0);
    if (!target) return { message: "Ningún agente tiene un pedido pendiente de recoger" };

    const affectedAgents = [];
    for (const agent of holders(target.external_order_number)) {
      const remaining = agent.plan.stops.filter((s) => !s.done && s.orderNumber !== target.external_order_number);
      agent.counters.cancelledOrders += 1;
      delete agent.commitments[target.external_order_number];
      agent.plan = remaining.length ? await this.buildPlan(agent, remaining.map(freshStop), this.clock, "DELIVERY") : null;

      await this.hooks.onOrderCancelled?.({ agentCode: agent.code, order: target, second: this.clock });
      await this.hooks.onRouteChanged?.({
        agentCode: agent.code,
        route: agent.plan ? this.routePayload(agent, this.clock) : null,
        position: agent.position,
        second: this.clock,
      });
      affectedAgents.push(agent.code);
    }

    return { orderNumber: target.external_order_number, affectedAgents };
  }

  // ------------------------------------------------------------- lectura

  agentStatus(agent) {
    const plan = agent.plan;
    if (!plan) return "IDLE";
    if (plan.kind === "REPOSITION") return "REPOSITIONING";
    const next = plan.stops.find((s) => !s.done);
    if (!next) return "IDLE";
    if (next.type === "PICKUP") return this.clock >= next.arriveSecond ? "WAITING_PICKUP" : "TO_PICKUP";
    return "TO_DROPOFF";
  }

  // Ruta restante para el mapa: coordenadas GeoJSON [lng, lat] y paradas.
  routePayload(agent, second = this.clock) {
    const plan = agent.plan;
    if (!plan) return null;

    // El mapa conserva la geometría completa de la asignación. El avance y
    // los cambios de ETA actualizan el marcador, no recrean el trazo.
    const coordinates = plan.displayCoordinates || plan.legs.flatMap(leg => leg.coordinates);

    const pendingStops = plan.stops.filter((s) => !s.done);
    const orderNumbers = [...new Set(pendingStops.filter((s) => s.orderNumber !== null).map((s) => s.orderNumber))];

    return {
      kind: plan.kind,
      endSecond: plan.endSecond,
      trafficVersion: this.traffic.version,
      coordinates,
      displayStops: plan.displayStops || plan.stops,
      stops: pendingStops.map((s) => ({
        type: s.type,
        lat: s.lat,
        lng: s.lng,
        orderNumber: s.orderNumber,
        etaSecond: s.arriveSecond,
      })),
      orders: orderNumbers.map((n) => {
        const o = this.orders.get(n);
        const eta = pendingStops.find((s) => s.type === "DROPOFF" && s.orderNumber === n)?.arriveSecond ?? null;
        return {
          id: o.id,
          orderNumber: n,
          merchantName: o.merchant_name,
          finalPayment: Number(o.final_payment),
          distanceKm: Number(o.distance_km),
          estimatedTimeMinutes: Number(o.estimated_time_minutes),
          routeSource: o.route_source,
          promisedSecond: agent.commitments[n]?.promisedSecond ?? null,
          etaSecond: eta,
        };
      }),
    };
  }

  snapshot() {
    const agents = {};
    for (const agent of Object.values(this.agents)) {
      agents[agent.code] = {
        lat: agent.position.lat,
        lng: agent.position.lng,
        status: this.agentStatus(agent),
        counters: Object.fromEntries(Object.entries(agent.counters).map(([k, v]) => [k, round2(v)])),
      };
    }
    return { second: this.clock, trafficLevel: this.conditions().level, trafficVersion: this.traffic.version, agents };
  }
}

module.exports = SimulationCore;
module.exports.AGENT_CODES = AGENT_CODES;
