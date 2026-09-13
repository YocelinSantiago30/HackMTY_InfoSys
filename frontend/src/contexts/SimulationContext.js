import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { disconnectSocket, joinSimulation, leaveSimulation } from "../services/socket";
import {
  createSimulationRequest,
  getComparisonRequest,
  getSimulationRequest,
  pauseSimulationRequest,
  resumeSimulationRequest,
  setSpeedRequest,
  startSimulationRequest,
  stopSimulationRequest,
} from "../api/simulation.api";

// Estado de la simulación compartido entre pantallas: Comparación la
// controla; Mapa dibuja repartidores y rutas con los mismos datos.
export const EMPTY_METRICS = {
  totalEarnings: 0,
  grossEarnings: 0,
  operatingCost: 0,
  acceptedOrders: 0,
  rejectedOrders: 0,
  completedOrders: 0,
  batchedOrders: 0,
  distanceKm: 0,
  earningsPerMinute: 0,
  earningsPerKm: 0,
  idleMinutes: 0,
  efficiencyScore: 0,
  netPerWorkedHour: 0,
  lateDeliveries: 0,
  lateRate: 0,
  averageDelayMinutes: 0,
  averageEtaErrorMinutes: 0,
  overtimeMinutes: 0,
};

export const SPEED_OPTIONS = [1, 2, 5, 10];

const EMPTY_AGENTS = { BASELINE: EMPTY_METRICS, SMARTCOURIER: EMPTY_METRICS };
const EMPTY_BY_AGENT = { BASELINE: null, SMARTCOURIER: null };
const REFRESH_INTERVAL_MS = 5000;

const SOCKET_EVENTS = [
  "new_order",
  "baseline_decision",
  "smart_decision",
  "metrics_updated",
  "simulation_tick",
  "route_updated",
  "order_completed",
  "simulation_event",
  "simulation_speed_changed",
  "simulation_paused",
  "simulation_resumed",
  "simulation_finished",
];

const SimulationContext = createContext(null);

export function SimulationProvider({ children }) {
  const { token } = useAuth();

  const [simulation, setSimulation] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clock, setClock] = useState({ second: 0, durationSeconds: 0, trafficLevel: null });
  const [agents, setAgents] = useState(EMPTY_AGENTS);
  const [comparison, setComparison] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [baselineDecision, setBaselineDecision] = useState(null);
  const [smartDecision, setSmartDecision] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [couriers, setCouriers] = useState(EMPTY_BY_AGENT);
  const [routes, setRoutes] = useState(EMPTY_BY_AGENT);

  const socketRef = useRef(null);
  const simulationIdRef = useRef(null);
  const currentOrderIdRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  function stopRefreshLoop() {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }

  async function refreshComparison(simulationId) {
    try {
      const data = await getComparisonRequest(simulationId);
      if (simulationId !== simulationIdRef.current) return;
      if (data.agents) setAgents({ ...EMPTY_AGENTS, ...data.agents });
      if (data.comparison) setComparison(data.comparison);
    } catch (error) {
      // silencioso: el próximo refresco o evento de socket lo corrige
    }
  }

  // Quita los listeners de la simulación anterior: sin esto, cada demo nueva
  // sumaba otra copia de cada handler (estados y refrescos duplicados).
  function unbindSocket() {
    const socket = socketRef.current;
    if (!socket) return;
    SOCKET_EVENTS.forEach((event) => socket.off(event));
    socket.io.off("reconnect");
    leaveSimulation(simulationIdRef.current);
  }

  function bindSocket(socket, simulationId) {
    socketRef.current = socket;
    // Una sala anterior podría seguir emitiendo: solo se aceptan eventos de esta simulación.
    const on = (event, handler) =>
      socket.on(event, (payload) => {
        if (payload?.simulationId === simulationId) handler(payload);
      });

    on("new_order", (order) => {
      currentOrderIdRef.current = order.id;
      setCurrentOrder(order);
      setBaselineDecision(null);
      setSmartDecision(null);
    });
    on("baseline_decision", (payload) => {
      if (payload.orderId === currentOrderIdRef.current) setBaselineDecision(payload);
    });
    on("smart_decision", (payload) => {
      if (payload.orderId === currentOrderIdRef.current) setSmartDecision(payload);
    });
    on("metrics_updated", (payload) => {
      if (payload.agents) setAgents({ ...EMPTY_AGENTS, ...payload.agents });
      if (payload.comparison) setComparison(payload.comparison);
    });
    on("simulation_tick", (payload) => {
      setClock({ second: payload.second, durationSeconds: payload.durationSeconds, trafficLevel: payload.trafficLevel });
      setSpeed(payload.speed);
      setCouriers(payload.agents);
    });
    on("route_updated", ({ agentCode, route, position }) => {
      setRoutes((prev) => ({ ...prev, [agentCode]: route }));
      setCouriers((prev) => ({ ...prev, [agentCode]: { ...prev[agentCode], ...position } }));
    });
    on("order_completed", ({ agentCode, position }) => {
      setCouriers((prev) => ({ ...prev, [agentCode]: { ...prev[agentCode], ...position } }));
    });
    on("simulation_event", (payload) => {
      setRecentEvents((prev) => [{ ...payload, id: `${payload.eventType}-${Date.now()}` }, ...prev].slice(0, 5));
    });
    on("simulation_speed_changed", (payload) => setSpeed(payload.speed));
    // Tras una reconexión (p. ej. el servidor se reinició) el estado real
    // puede haber cambiado a PAUSED: se vuelve a leer del backend.
    socket.io.off("reconnect");
    socket.io.on("reconnect", async () => {
      try {
        const latest = await getSimulationRequest(simulationId);
        if (simulationId === simulationIdRef.current) setSimulation(latest);
      } catch (error) {
        // se reintenta en la siguiente reconexión
      }
    });
    on("simulation_paused", (updated) => setSimulation(updated));
    on("simulation_resumed", (updated) => setSimulation(updated));
    on("simulation_finished", (updated) => {
      setSimulation(updated);
      stopRefreshLoop();
      refreshComparison(simulationId);
    });
  }

  function clearSimulationState() {
    setCurrentOrder(null);
    setBaselineDecision(null);
    setSmartDecision(null);
    setComparison(null);
    setRecentEvents([]);
    setAgents(EMPTY_AGENTS);
    setCouriers(EMPTY_BY_AGENT);
    setRoutes(EMPTY_BY_AGENT);
    setClock({ second: 0, durationSeconds: 0, trafficLevel: null });
    currentOrderIdRef.current = null;
  }

  async function startDemo() {
    setIsStarting(true);
    stopRefreshLoop();
    unbindSocket();
    clearSimulationState();

    try {
      const created = await createSimulationRequest({ mode: "DEMO" });
      simulationIdRef.current = created.id;

      // Primero la sala, después el arranque: así no se pierden los primeros eventos.
      const socket = await joinSimulation(created.id, token);
      bindSocket(socket, created.id);

      const started = await startSimulationRequest(created.id);
      setSimulation(started);
      setSpeed(started.speed_multiplier || 1);
      setClock({ second: 0, durationSeconds: started.simulation_duration_seconds, trafficLevel: null });

      refreshComparison(started.id);
      refreshIntervalRef.current = setInterval(() => refreshComparison(simulationIdRef.current), REFRESH_INTERVAL_MS);

      return started;
    } catch (error) {
      unbindSocket();
      simulationIdRef.current = null;
      throw error;
    } finally {
      setIsStarting(false);
    }
  }

  async function pause() {
    setSimulation(await pauseSimulationRequest(simulation.id));
  }

  async function resume() {
    setSimulation(await resumeSimulationRequest(simulation.id));
  }

  async function stop() {
    stopRefreshLoop();
    setSimulation(await stopSimulationRequest(simulation.id));
    await refreshComparison(simulation.id);
  }

  async function changeSpeed(nextSpeed) {
    const previous = speed;
    setSpeed(nextSpeed);
    try {
      await setSpeedRequest(simulation.id, nextSpeed);
    } catch (error) {
      setSpeed(previous);
      throw error;
    }
  }

  function reset() {
    stopRefreshLoop();
    unbindSocket();
    disconnectSocket();
    simulationIdRef.current = null;
    setSimulation(null);
    clearSimulationState();
  }

  useEffect(() => stopRefreshLoop, []);

  const value = {
    simulation,
    isStarting,
    speed,
    clock,
    agents,
    comparison,
    currentOrder,
    baselineDecision,
    smartDecision,
    recentEvents,
    couriers,
    routes,
    startDemo,
    pause,
    resume,
    stop,
    changeSpeed,
    reset,
  };

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const context = useContext(SimulationContext);

  if (!context) {
    throw new Error("useSimulation debe usarse dentro de un SimulationProvider");
  }

  return context;
}
