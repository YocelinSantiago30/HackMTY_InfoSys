// Piezas compartidas para mostrar una decisión de agente (badge + razones
// expandibles). Las usan CurrentOrderCard (Comparison) e HistoryScreen para
// no duplicar el render de "reasons" con las dos formas distintas que
// produce cada agente (criterios de Baseline vs factores de SmartCourier).
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DECISION_COLORS, DECISION_ICONS, TEXT_COLORS } from "../constants/theme";

export function DecisionBadge({ label, decision, style }) {
  const color = DECISION_COLORS[decision] || TEXT_COLORS.muted;
  const icon = DECISION_ICONS[decision];

  return (
    <View style={[styles.decisionRow, style]}>
      {label && <Text style={styles.decisionLabel}>{label}</Text>}
      <View style={styles.decisionValueRow}>
        {icon && <Ionicons name={icon} size={14} color={color} />}
        <Text style={[styles.decisionValue, { color }]}>{decision || "..."}</Text>
      </View>
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
    <View style={styles.restrictionRow}>
      <Ionicons name="warning" size={13} color={DECISION_COLORS.REJECT} />
      <Text style={styles.restrictionText}>{restrictions.map((r) => r.message).join(" · ")}</Text>
    </View>
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
  decisionValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  restrictionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  restrictionText: {
    flex: 1,
    fontSize: 11,
    color: DECISION_COLORS.REJECT,
    fontWeight: "600",
  },
});
