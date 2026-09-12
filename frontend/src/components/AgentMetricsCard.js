import { StyleSheet, Text, View } from "react-native";
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
      <Text style={[styles.title, { color }]}>
        {icon} {title}
      </Text>

      <Text style={styles.earnings}>${metrics.totalEarnings.toFixed(2)}</Text>

      <Row label="Aceptados" value={metrics.acceptedOrders} />
      <Row label="Rechazados" value={metrics.rejectedOrders} />
      <Row label="Completados" value={metrics.completedOrders} />
      <Row label="Distancia" value={`${metrics.distanceKm.toFixed(1)} km`} />
      <Row label="Ganancia/min" value={`$${metrics.earningsPerMinute.toFixed(2)}`} />
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
  title: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  earnings: {
    fontSize: 24,
    fontWeight: "bold",
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
