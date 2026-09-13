import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AGENT_COLORS, AGENT_ICONS, DECISION_COLORS, TEXT_COLORS } from "../constants/theme";

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
      <View style={styles.columnTitleRow}>
        <Ionicons name={icon} size={15} color={color} />
        <Text style={[styles.columnTitle, { color }]}>{AGENT_TITLES[agentCode]}</Text>
      </View>
      <Text style={styles.earnings}>${metrics.totalEarnings.toFixed(2)}</Text>
      <Text style={styles.row}>Neto (cobrado ${metrics.grossEarnings.toFixed(0)} - costo ${metrics.operatingCost.toFixed(0)})</Text>
      <Text style={styles.row}>Neto/h trabajada: ${metrics.netPerWorkedHour.toFixed(2)}</Text>
      <Text style={styles.row}>Horas extra: {metrics.overtimeMinutes.toFixed(0)} min</Text>
      <Text style={styles.row}>Entregas: {metrics.completedOrders} ({metrics.lateDeliveries} tarde)</Text>
      <Text style={styles.row}>Retraso prom.: {metrics.averageDelayMinutes.toFixed(1)} min</Text>
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
      <View style={styles.titleRow}>
        <Ionicons name="flag" size={18} color={TEXT_COLORS.primary} />
        <Text style={styles.title}>RESULTADO DEL TURNO</Text>
      </View>

      <View style={styles.columnsRow}>
        <ResultColumn agentCode="BASELINE" metrics={agents.BASELINE} />
        <ResultColumn agentCode="SMARTCOURIER" metrics={agents.SMARTCOURIER} />
      </View>

      {improvement !== null && improvement !== undefined && (
        <View style={[styles.diffBanner, isPositive ? styles.diffPositive : styles.diffNegative]}>
          <View style={styles.diffTextRow}>
            <Ionicons
              name={isPositive ? "trending-up" : "trending-down"}
              size={16}
              color={isPositive ? DECISION_COLORS.ACCEPT : DECISION_COLORS.REJECT}
            />
            <Text style={styles.diffText}>
              SmartCourier: {isPositive ? "+" : ""}
              {improvement.toFixed(1)}% {isPositive ? "más" : "menos"} ganancia neta que Baseline
            </Text>
          </View>
          <Text style={styles.diffSubtext}>
            Diferencia: ${comparison.totalEarnings.absoluteDifference.toFixed(2)} · neto/h trabajada $
            {agents.BASELINE.netPerWorkedHour.toFixed(0)} vs ${agents.SMARTCOURIER.netPerWorkedHour.toFixed(0)}
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
  titleRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
  },
  columnsRow: {
    flexDirection: "row",
    gap: 12,
  },
  column: {
    flex: 1,
    alignItems: "center",
  },
  columnTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: "700",
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
  diffTextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
