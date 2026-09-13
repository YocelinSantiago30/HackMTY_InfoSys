import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DecisionBadge } from "./decisionDisplay";
import DecisionInspectorModal from "./DecisionInspectorModal";
import { AGENT_COLORS, TEXT_COLORS } from "../constants/theme";

export default function CurrentOrderCard({ order, baselineDecision, smartDecision }) {
  const [inspectorVisible, setInspectorVisible] = useState(false);

  if (!order) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyText}>Esperando el primer pedido...</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.orderTitle}>PEDIDO #{order.external_order_number}</Text>
      <Text style={styles.merchant}>{order.merchant_name}</Text>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>${order.final_payment}</Text>
        <Text style={styles.stat}>{order.distance_km} km</Text>
        <Text style={styles.stat}>{order.estimated_time_minutes} min</Text>
      </View>

      <DecisionBadge label="BASELINE" decision={baselineDecision?.decision} />
      <DecisionBadge label="SMARTCOURIER" decision={smartDecision?.decision} />
      {smartDecision?.score !== undefined && smartDecision?.score !== null && (
        <Text style={styles.scoreText}>
          Score SmartCourier: {smartDecision.score}/100
          {smartDecision.estimatedImpact?.netProfit !== undefined &&
            ` · neto $${smartDecision.estimatedImpact.netProfit.toFixed(2)} en ${smartDecision.estimatedImpact.totalMinutes.toFixed(0)} min ($${smartDecision.estimatedImpact.profitPerMinute.toFixed(2)}/min)`}
        </Text>
      )}
      {smartDecision?.estimatedImpact?.lookahead && (
        <Text style={styles.scoreText}>
          Simulado {smartDecision.estimatedImpact.lookahead.horizonMinutes} min ×{" "}
          {smartDecision.estimatedImpact.lookahead.scenarios} escenarios: aceptar $
          {smartDecision.estimatedImpact.lookahead.accept.mean.toFixed(0)} vs esperar $
          {smartDecision.estimatedImpact.lookahead.wait.mean.toFixed(0)}
        </Text>
      )}
      {smartDecision?.decision === "BATCH" && smartDecision.estimatedImpact && (
        <Text style={styles.scoreText}>
          Agrupado: +${smartDecision.estimatedImpact.additionalNetProfit.toFixed(2)} netos por +
          {smartDecision.estimatedImpact.additionalTime.toFixed(0)} min
        </Text>
      )}

      <Pressable
        style={styles.viewDecisionButton}
        onPress={() => setInspectorVisible(true)}
        disabled={!baselineDecision && !smartDecision}
      >
        <Text style={styles.viewDecisionLink}>Ver Decision Inspector</Text>
      </Pressable>

      <DecisionInspectorModal
        visible={inspectorVisible}
        orderId={order.id}
        onClose={() => setInspectorVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginTop: 12,
  },
  emptyText: {
    textAlign: "center",
    color: TEXT_COLORS.muted,
    fontStyle: "italic",
  },
  orderTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    letterSpacing: 0.5,
  },
  merchant: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 12,
  },
  stat: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT_COLORS.primary,
  },
  scoreText: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    marginTop: 4,
  },
  viewDecisionButton: {
    marginTop: 10,
    paddingVertical: 10,
  },
  viewDecisionLink: {
    color: AGENT_COLORS.SMARTCOURIER,
    fontSize: 13,
    fontWeight: "600",
  },
});
