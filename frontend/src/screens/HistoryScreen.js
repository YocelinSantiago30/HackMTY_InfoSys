import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getHistoryRequest } from "../api/history.api";
import { listSimulationsRequest } from "../api/simulation.api";
import { DecisionBadge } from "../components/decisionDisplay";
import DecisionInspectorModal from "../components/DecisionInspectorModal";
import { AGENT_COLORS, AGENT_ICONS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

const AGENT_OPTIONS = [
  { value: null, label: "Todos" },
  { value: "BASELINE", label: "Baseline" },
  { value: "SMARTCOURIER", label: "SmartCourier" },
];

const DECISION_OPTIONS = [
  { value: null, label: "Todas" },
  { value: "ACCEPT", label: "Aceptado" },
  { value: "REJECT", label: "Rechazado" },
  { value: "WAIT", label: "Esperar" },
];

function Chip({ label, active, onPress }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatSimulationLabel(simulation) {
  const time = new Date(simulation.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${simulation.mode} ${time}`;
}

function HistoryRecord({ record }) {
  const [inspectorVisible, setInspectorVisible] = useState(false);

  return (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={[styles.recordAgent, { color: AGENT_COLORS[record.agent_code] }]}>
          {AGENT_ICONS[record.agent_code]} {record.agent_code}
        </Text>
        <Text style={styles.recordTime}>
          {new Date(record.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>

      <Text style={styles.recordMerchant}>
        #{record.external_order_number} {record.merchant_name}
      </Text>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>${record.final_payment}</Text>
        <Text style={styles.stat}>{record.distance_km} km</Text>
        <Text style={styles.stat}>{record.estimated_time_minutes} min</Text>
      </View>

      <DecisionBadge decision={record.decision} />
      {record.score !== null && record.score !== undefined && (
        <Text style={styles.scoreText}>Score: {record.score}/100</Text>
      )}

      <Pressable style={styles.viewLinkButton} onPress={() => setInspectorVisible(true)}>
        <Text style={styles.viewLink}>Ver Decision Inspector</Text>
      </Pressable>

      <DecisionInspectorModal
        visible={inspectorVisible}
        orderId={record.order_id}
        onClose={() => setInspectorVisible(false)}
      />
    </View>
  );
}

export default function HistoryScreen() {
  const [simulations, setSimulations] = useState([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    listSimulationsRequest()
      .then(setSimulations)
      .catch(() => setSimulations([]));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    getHistoryRequest({
      agent: selectedAgent,
      decision: selectedDecision,
      simulationId: selectedSimulationId,
    })
      .then((data) => setRecords(data.records))
      .catch(() => setRecords([]))
      .finally(() => setIsLoading(false));
  }, [selectedAgent, selectedDecision, selectedSimulationId]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <Chip
          label="Todos los turnos"
          active={selectedSimulationId === null}
          onPress={() => setSelectedSimulationId(null)}
        />
        {simulations.map((sim) => (
          <Chip
            key={sim.id}
            label={formatSimulationLabel(sim)}
            active={selectedSimulationId === sim.id}
            onPress={() => setSelectedSimulationId(sim.id)}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {AGENT_OPTIONS.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            active={selectedAgent === option.value}
            onPress={() => setSelectedAgent(option.value)}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {DECISION_OPTIONS.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            active={selectedDecision === option.value}
            onPress={() => setSelectedDecision(option.value)}
          />
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {records.length === 0 ? (
            <Text style={styles.emptyText}>Sin registros para estos filtros</Text>
          ) : (
            records.map((record) => <HistoryRecord key={record.id} record={record} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  filterRow: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  chip: {
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "#e0e0e0",
    marginRight: 8,
    minHeight: 36,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
  },
  chipText: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#fff",
  },
  loading: {
    marginTop: 40,
  },
  list: {
    padding: 12,
    paddingBottom: 48,
  },
  emptyText: {
    textAlign: "center",
    color: TEXT_COLORS.muted,
    fontStyle: "italic",
    marginTop: 40,
  },
  recordCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  recordHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  recordAgent: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  recordTime: {
    fontSize: 11,
    color: TEXT_COLORS.muted,
  },
  recordMerchant: {
    fontSize: 15,
    fontWeight: "bold",
    marginTop: 2,
    marginBottom: 6,
  },
  statsRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 6,
  },
  stat: {
    fontSize: 13,
    fontWeight: "600",
    color: TEXT_COLORS.primary,
  },
  scoreText: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    marginTop: 4,
  },
  viewLinkButton: {
    marginTop: 4,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  viewLink: {
    color: AGENT_COLORS.SMARTCOURIER,
    fontSize: 12,
    fontWeight: "600",
  },
});
