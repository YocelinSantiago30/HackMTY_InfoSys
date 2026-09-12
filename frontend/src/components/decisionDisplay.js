// Piezas compartidas para mostrar una decisión de agente (badge + razones
// expandibles). Las usan CurrentOrderCard (Comparison) e HistoryScreen para
// no duplicar el render de "reasons" con las dos formas distintas que
// produce cada agente (criterios de Baseline vs factores de SmartCourier).
import { StyleSheet, Text, View } from "react-native";
import { DECISION_COLORS, DECISION_ICONS, TEXT_COLORS } from "../constants/theme";

export function DecisionBadge({ label, decision, style }) {
  const color = DECISION_COLORS[decision] || TEXT_COLORS.muted;
  const icon = DECISION_ICONS[decision] || "";

  return (
    <View style={[styles.decisionRow, style]}>
      {label && <Text style={styles.decisionLabel}>{label}</Text>}
      <Text style={[styles.decisionValue, { color }]}>
        {icon} {decision || "..."}
      </Text>
    </View>
  );
}

export function ReasonsList({ reasons }) {
  if (!reasons || reasons.length === 0) return null;

  return (
    <View style={styles.reasonsList}>
      {reasons.map((reason, index) => (
        <Text key={index} style={styles.reasonText}>
          {reason.criterion || reason.factor}:{" "}
          {typeof reason.points === "number"
            ? `${reason.points > 0 ? "+" : ""}${reason.points}pts`
            : `${reason.value} ${reason.comparator} ${reason.threshold} (${reason.passed ? "✓" : "✗"})`}
        </Text>
      ))}
    </View>
  );
}

export function RestrictionsText({ restrictions }) {
  if (!restrictions || restrictions.length === 0) return null;

  return (
    <Text style={styles.restrictionText}>
      ⛔ {restrictions.map((r) => r.message).join(" · ")}
    </Text>
  );
}

const styles = StyleSheet.create({
  decisionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  decisionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: TEXT_COLORS.secondary,
  },
  decisionValue: {
    fontSize: 13,
    fontWeight: "bold",
  },
  reasonsList: {
    marginLeft: 4,
  },
  reasonText: {
    fontSize: 11,
    color: TEXT_COLORS.secondary,
  },
  restrictionText: {
    fontSize: 11,
    color: DECISION_COLORS.REJECT,
    fontWeight: "600",
    marginTop: 4,
  },
});
