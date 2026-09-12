import { StyleSheet, Text, View } from "react-native";
import { AGENT_COLORS, AGENT_ICONS, TEXT_COLORS } from "../constants/theme";

const AGENT_TITLES = {
  BASELINE: "Baseline",
  SMARTCOURIER: "SmartCourier AI",
};

// Sección 47: pantalla de resultado final. El porcentaje sale directo de
// metrics.service (backend) — no se recalcula ni se "ajusta" aquí, para
// no manipular el resultado (sección 29).
function ResultColumn({ agentCode, metrics }) {
  const color = AGENT_COLORS[agentCode];
  const icon = AGENT_ICONS[agentCode];

  return (
    <View style={styles.column}>
      <Text style={[styles.columnTitle, { color }]}>
        {icon} {AGENT_TITLES[agentCode]}
      </Text>
      <Text style={styles.earnings}>${metrics.totalEarnings.toFixed(2)}</Text>
      <Text style={styles.row}>Pedidos: {metrics.completedOrders}</Text>
      <Text style={styles.row}>Distancia: {metrics.distanceKm.toFixed(1)} km</Text>
      <Text style={styles.row}>Ocioso: {metrics.idleMinutes.toFixed(1)} min</Text>
      <Text style={styles.row}>Utilización: {metrics.efficiencyScore.toFixed(0)}%</Text>
    </View>
  );
}

export default function DemoResultBanner({ agents, comparison }) {
  const improvement = comparison?.totalEarnings?.percentageImprovement;
  const isPositive = improvement !== null && improvement !== undefined && improvement >= 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🏁 RESULTADO DEL TURNO</Text>

      <View style={styles.columnsRow}>
        <ResultColumn agentCode="BASELINE" metrics={agents.BASELINE} />
        <ResultColumn agentCode="SMARTCOURIER" metrics={agents.SMARTCOURIER} />
      </View>

      {improvement !== null && improvement !== undefined && (
        <View style={[styles.diffBanner, isPositive ? styles.diffPositive : styles.diffNegative]}>
          <Text style={styles.diffText}>
            {isPositive ? "📈" : "📉"} SmartCourier: {isPositive ? "+" : ""}
            {improvement.toFixed(1)}% {isPositive ? "más" : "menos"} que Baseline
          </Text>
          <Text style={styles.diffSubtext}>
            Diferencia: ${comparison.totalEarnings.absoluteDifference.toFixed(2)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 12,
  },
  columnsRow: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
    alignItems: "center",
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  earnings: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 6,
  },
  row: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
  },
  diffBanner: {
    marginTop: 16,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  diffPositive: {
    backgroundColor: "#e8f5e9",
  },
  diffNegative: {
    backgroundColor: "#ffebee",
  },
  diffText: {
    fontSize: 15,
    fontWeight: "bold",
    color: TEXT_COLORS.primary,
  },
  diffSubtext: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    marginTop: 2,
  },
});
