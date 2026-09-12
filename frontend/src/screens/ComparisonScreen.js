import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import AgentMetricsCard from "../components/AgentMetricsCard";
import CurrentOrderCard from "../components/CurrentOrderCard";
import InjectEventPanel from "../components/InjectEventPanel";
import DemoResultBanner from "../components/DemoResultBanner";
import { disconnectSocket, joinSimulation } from "../services/socket";
import { AGENT_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";
import {
  createSimulationRequest,
  getComparisonRequest,
  pauseSimulationRequest,
  resumeSimulationRequest,
  startSimulationRequest,
  stopSimulationRequest,
} from "../api/simulation.api";

const EMPTY_METRICS = {
  totalEarnings: 0,
  acceptedOrders: 0,
  rejectedOrders: 0,
  completedOrders: 0,
  distanceKm: 0,
  earningsPerMinute: 0,
  earningsPerKm: 0,
  idleMinutes: 0,
  efficiencyScore: 0,
};

const REFRESH_INTERVAL_MS = 3000;

const EVENT_LABELS = {
  SURGE_STARTED: "⚡ Surge activado",
  SURGE_ENDED: "⚡ Surge terminado",
  TRAFFIC_INCREASED: "🚗 Tráfico pesado",
  TRAFFIC_DECREASED: "🚗 Tráfico normal",
  ROAD_CLOSED: "🚧 Cierre vial",
  ROAD_REOPENED: "🚧 Vía reabierta",
  ORDER_CANCELLED: "❌ Pedido cancelado",
  HIGH_DEMAND: "📈 Demanda alta",
  LOW_DEMAND: "📉 Demanda baja",
  URGENT_ORDER: "🔥 Pedido urgente",
};

export default function ComparisonScreen() {
  const { token } = useAuth();

  const [simulation, setSimulation] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [agents, setAgents] = useState({ BASELINE: EMPTY_METRICS, SMARTCOURIER: EMPTY_METRICS });
  const [comparison, setComparison] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [baselineDecision, setBaselineDecision] = useState(null);
  const [smartDecision, setSmartDecision] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);

  const refreshIntervalRef = useRef(null);
  const simulationIdRef = useRef(null);

  useEffect(() => {
    return () => {
      stopRefreshLoop();
      disconnectSocket();
    };
  }, []);

  function stopRefreshLoop() {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }

  async function refreshComparison(simulationId) {
    try {
      const data = await getComparisonRequest(simulationId);
      if (data.agents) setAgents(data.agents);
      if (data.comparison) setComparison(data.comparison);
    } catch (error) {
      // silencioso: el próximo tick de refresco lo vuelve a intentar
    }
  }

  async function handleStart() {
    setIsStarting(true);

    try {
      const created = await createSimulationRequest({ mode: "DEMO" });
      const started = await startSimulationRequest(created.id);

      simulationIdRef.current = started.id;
      setSimulation(started);
      setCurrentOrder(null);
      setBaselineDecision(null);
      setSmartDecision(null);
      setComparison(null);
      setRecentEvents([]);

      const socket = await joinSimulation(started.id, token);

      socket.on("new_order", (order) => {
        setCurrentOrder(order);
        setBaselineDecision(null);
        setSmartDecision(null);
      });

      socket.on("baseline_decision", (payload) => {
        setBaselineDecision(payload);
      });

      socket.on("smart_decision", (payload) => {
        setSmartDecision(payload);
      });

      socket.on("metrics_updated", () => {
        refreshComparison(simulationIdRef.current);
      });

      socket.on("simulation_event", (payload) => {
        setRecentEvents((prev) => [
          { ...payload, id: `${payload.eventType}-${Date.now()}` },
          ...prev,
        ].slice(0, 5));
      });

      socket.on("simulation_paused", (updated) => setSimulation(updated));
      socket.on("simulation_resumed", (updated) => setSimulation(updated));
      socket.on("simulation_finished", (updated) => {
        setSimulation(updated);
        stopRefreshLoop();
        refreshComparison(simulationIdRef.current);
      });

      refreshComparison(started.id);
      refreshIntervalRef.current = setInterval(() => {
        refreshComparison(simulationIdRef.current);
      }, REFRESH_INTERVAL_MS);
    } catch (error) {
      Alert.alert("Error", error.response?.data?.message || error.message || "No se pudo iniciar la simulación");
    } finally {
      setIsStarting(false);
    }
  }

  async function handlePause() {
    const updated = await pauseSimulationRequest(simulation.id);
    setSimulation(updated);
  }

  async function handleResume() {
    const updated = await resumeSimulationRequest(simulation.id);
    setSimulation(updated);
  }

  async function handleStop() {
    stopRefreshLoop();
    const updated = await stopSimulationRequest(simulation.id);
    setSimulation(updated);
    await refreshComparison(simulation.id);
  }

  if (!simulation) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>📊 Comparación</Text>
        <Text style={styles.subtitle}>
          Compara Baseline vs SmartCourier AI en un turno simulado.
        </Text>
        <Pressable
          style={[styles.startButton, isStarting && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isStarting}
        >
          {isStarting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.startButtonText}>Iniciar simulación DEMO</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>{simulation.status}</Text>
        <View style={styles.controls}>
          {simulation.status === "RUNNING" && (
            <Pressable style={styles.controlButton} onPress={handlePause}>
              <Text style={styles.controlButtonText}>Pausar</Text>
            </Pressable>
          )}
          {simulation.status === "PAUSED" && (
            <Pressable style={styles.controlButton} onPress={handleResume}>
              <Text style={styles.controlButtonText}>Reanudar</Text>
            </Pressable>
          )}
          {["RUNNING", "PAUSED"].includes(simulation.status) && (
            <Pressable style={[styles.controlButton, styles.stopButton]} onPress={handleStop}>
              <Text style={styles.controlButtonText}>Detener</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.cardsRow}>
        <AgentMetricsCard agentCode="BASELINE" metrics={agents.BASELINE || EMPTY_METRICS} />
        <AgentMetricsCard agentCode="SMARTCOURIER" metrics={agents.SMARTCOURIER || EMPTY_METRICS} />
      </View>

      {simulation.status === "FINISHED" ? (
        <DemoResultBanner agents={agents} comparison={comparison} />
      ) : (
        <CurrentOrderCard
          order={currentOrder}
          baselineDecision={baselineDecision}
          smartDecision={smartDecision}
        />
      )}

      {simulation.mode === "DEMO" && simulation.status === "RUNNING" && (
        <InjectEventPanel simulationId={simulation.id} />
      )}

      {recentEvents.length > 0 && (
        <View style={styles.eventLog}>
          <Text style={styles.eventLogTitle}>EVENTOS RECIENTES</Text>
          {recentEvents.map((event) => (
            <Text key={event.id} style={styles.eventLogItem}>
              {EVENT_LABELS[event.eventType] || event.eventType} (seg. {event.occurredAtSimulationSecond})
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: TEXT_COLORS.secondary,
    textAlign: "center",
    marginBottom: 24,
  },
  startButton: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_COLORS.secondary,
  },
  controls: {
    flexDirection: "row",
    gap: 8,
  },
  controlButton: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
    borderRadius: 6,
    paddingHorizontal: 14,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    alignItems: "center",
  },
  stopButton: {
    backgroundColor: "#c62828",
  },
  controlButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  cardsRow: {
    flexDirection: "row",
    gap: 10,
  },
  eventLog: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  eventLogTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  eventLogItem: {
    fontSize: 12,
    color: TEXT_COLORS.primary,
    paddingVertical: 2,
  },
});
