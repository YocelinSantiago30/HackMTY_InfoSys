import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AGENT_COLORS, AGENT_ICONS, TEXT_COLORS } from "../constants/theme";

const AGENT_TITLES = {
  BASELINE: "Baseline",
  SMARTCOURIER: "SmartCourier AI",
};

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  ); 
}

export default function AgentMetricsCard({ agentCode, metrics }) {
  const color = AGENT_COLORS[agentCode] || TEXT_COLORS.secondary;
  const icon = AGENT_ICONS[agentCode] || "";
  const title = AGENT_TITLES[agentCode] || agentCode;

  return (
    <View style={[styles.card, { borderColor: color }]}>
      <View style={styles.titleRow}>
        {icon && <Ionicons name={icon} size={16} color={color} />}
        <Text style={[styles.title, { color }]}>{title}</Text>
      </View>

      <Text style={styles.earnings}>${metrics.totalEarnings.toFixed(2)}</Text>
      <Text style={styles.earningsLabel}>ganancia neta</Text>

      <Row label="Cobrado" value={`$${metrics.grossEarnings.toFixed(2)}`} />
      <Row label="Costo operativo" value={`-$${metrics.operatingCost.toFixed(2)}`} />
      <Row label="Aceptados" value={metrics.acceptedOrders} />
      <Row label="Rechazados" value={metrics.rejectedOrders} />
      <Row label="Entregados" value={metrics.completedOrders} />
      {agentCode === "SMARTCOURIER" && <Row label="Agrupados" value={metrics.batchedOrders} />}
      <Row label="Distancia" value={`${metrics.distanceKm.toFixed(1)} km`} />
      <Row label="Neto/h trabajada" value={`$${(metrics.netPerWorkedHour ?? 0).toFixed(2)}`} />
      <Row label="Entregas tarde" value={`${metrics.lateDeliveries ?? 0} (${(metrics.lateRate ?? 0).toFixed(0)}%)`} />
      <Row label="Error ETA prom." value={`${(metrics.averageEtaErrorMinutes ?? 0).toFixed(1)} min`} />
      <Row label="Ganancia/km" value={`$${metrics.earningsPerKm.toFixed(2)}`} />
      <Row label="Tiempo ocioso" value={`${metrics.idleMinutes.toFixed(1)} min`} />
      <Row label="Utilización" value={`${metrics.efficiencyScore.toFixed(0)}%`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 2,
    padding: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  earnings: {
    fontSize: 24,
    fontWeight: "bold",
  },
  earningsLabel: {
    fontSize: 11,
    color: TEXT_COLORS.muted,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  rowLabel: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
  },
  rowValue: {
    fontSize: 12,
    fontWeight: "600",
  },
});
