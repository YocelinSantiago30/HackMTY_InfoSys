import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { EMPTY_METRICS, useSimulation } from "../contexts/SimulationContext";
import AgentMetricsCard from "../components/AgentMetricsCard";
import CurrentOrderCard from "../components/CurrentOrderCard";
import InjectEventPanel from "../components/InjectEventPanel";
import DemoResultBanner from "../components/DemoResultBanner";
import SpeedControl from "../components/SpeedControl";
import { formatShiftClock } from "../utils/shiftClock";
import { AGENT_COLORS, EVENT_ICONS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

const EVENT_LABELS = {
  SURGE_STARTED: "Surge activado",
  SURGE_ENDED: "Surge terminado",
  TRAFFIC_INCREASED: "Tráfico pesado",
  TRAFFIC_DECREASED: "Tráfico normal",
  ROAD_CLOSED: "Cierre vial",
  ROAD_REOPENED: "Vía reabierta",
  ORDER_CANCELLED: "Pedido cancelado",
  HIGH_DEMAND: "Demanda alta",
  LOW_DEMAND: "Demanda baja",
  URGENT_ORDER: "Pedido urgente",
};

const TRAFFIC_LABELS = { LOW: "fluido", MEDIUM: "moderado", HIGH: "pesado", SEVERE: "severo" };

export default function ComparisonScreen() {
  const {
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
    startDemo,
    pause,
    resume,
    stop,
    changeSpeed,
  } = useSimulation();

  async function handleStart() {
    try {
      await startDemo();
    } catch (error) {
      Alert.alert(
        "Error",
        error.response?.data?.message || error.message || "No se pudo iniciar la simulación"
      );
    }
  }

  async function handleSpeedChange(nextSpeed) {
    try {
      await changeSpeed(nextSpeed);
    } catch (error) {
      Alert.alert("Error", error.response?.data?.message || "No se pudo cambiar la velocidad");
    }
  }

  const isActive = ["RUNNING", "PAUSED"].includes(simulation?.status);
  const progress = clock.durationSeconds ? Math.min(1, clock.second / clock.durationSeconds) : 0;

  if (!simulation) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Ionicons name="bar-chart" size={36} color={AGENT_COLORS.SMARTCOURIER} style={styles.titleIcon} />
        <Text style={styles.title}>Comparación</Text>
        <Text style={styles.subtitle}>
          Compara Baseline vs SmartCourier AI en un turno simulado.
        </Text>
        <Pressable
          style={[styles.startButton, isStarting && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isStarting}
        >
          {isStarting ? (
            <View style={styles.startingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.startButtonText}>Calculando rutas...</Text>
            </View>
          ) : (
            <Text style={styles.startButtonText}>Iniciar simulación DEMO</Text>
          )}
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.statusText}>{simulation.status}</Text>
            <Text style={styles.clockText}>
              {formatShiftClock(clock.second)} · {Math.round(progress * 100)}% del turno
              {clock.trafficLevel ? ` · tráfico ${TRAFFIC_LABELS[clock.trafficLevel]}` : ""}
            </Text>
          </View>
          <View style={styles.controls}>
            {simulation.status === "RUNNING" && (
              <Pressable style={styles.controlButton} onPress={pause}>
                <Text style={styles.controlButtonText}>Pausar</Text>
              </Pressable>
            )}
            {simulation.status === "PAUSED" && (
              <Pressable style={styles.controlButton} onPress={resume}>
                <Text style={styles.controlButtonText}>Reanudar</Text>
              </Pressable>
            )}
            {isActive && (
              <Pressable style={[styles.controlButton, styles.stopButton]} onPress={stop}>
                <Text style={styles.controlButtonText}>Detener</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.speedBlock}>
          <Text style={styles.speedLabel}>VELOCIDAD DE LA DEMO</Text>
          <SpeedControl speed={speed} onChange={handleSpeedChange} disabled={!isActive} />
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
              <View key={event.id} style={styles.eventLogRow}>
                <Ionicons
                  name={EVENT_ICONS[event.eventType] || "ellipse"}
                  size={13}
                  color={TEXT_COLORS.primary}
                />
                <Text style={styles.eventLogItem}>
                  {EVENT_LABELS[event.eventType] || event.eventType} (seg.{" "}
                  {event.occurredAtSimulationSecond})
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
  titleIcon: {
    marginBottom: 8,
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
  clockText: {
    fontSize: 12,
    color: TEXT_COLORS.muted,
    marginTop: 2,
  },
  startingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressTrack: {
    height: 4,
    backgroundColor: "#e0e0e0",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: {
    height: 4,
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
  },
  speedBlock: {
    marginBottom: 12,
  },
  speedLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 6,
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
  eventLogRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  eventLogItem: {
    fontSize: 12,
    color: TEXT_COLORS.primary,
  },
});
