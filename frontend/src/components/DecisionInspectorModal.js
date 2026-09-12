import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getOrderDecisionsRequest } from "../api/order.api";
import { DecisionBadge, ReasonsList, RestrictionsText } from "./decisionDisplay";
import { DECISION_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

// El "¿Qué habría pasado si...?" (sección 9) es aritmética real, no
// inventada: como todavía no existe batching, invertir una decisión sobre
// UN pedido no afecta a ningún otro — el impacto es exactamente los propios
// números de ese pedido, con signo según la decisión real tomada.
function computeWhatIf(order, decision) {
  const payment = Number(order.final_payment);
  const distance = Number(order.distance_km);
  const time = Number(order.estimated_time_minutes);

  if (decision === "ACCEPT") {
    return {
      alternative: "Si hubiera RECHAZADO",
      estimatedProfitImpact: -payment,
      estimatedExtraDistance: -distance,
      estimatedExtraTime: -time,
    };
  }

  return {
    alternative: "Si hubiera ACEPTADO",
    estimatedProfitImpact: payment,
    estimatedExtraDistance: distance,
    estimatedExtraTime: time,
  };
}

function formatSigned(value, unit) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

function WhatIfBlock({ order, decision, label }) {
  if (!decision || decision === "BATCH" || decision === "REPOSITION" || decision === "REROUTE") {
    return null;
  }

  const whatIf = computeWhatIf(order, decision);

  return (
    <View style={styles.whatIfBlock}>
      <Text style={styles.whatIfAgent}>{label}</Text>
      <Text style={styles.whatIfAlternative}>{whatIf.alternative}:</Text>
      <Text style={styles.whatIfLine}>
        Ganancia: {formatSigned(whatIf.estimatedProfitImpact, "")}
      </Text>
      <Text style={styles.whatIfLine}>
        Distancia: {formatSigned(whatIf.estimatedExtraDistance, "km")}
      </Text>
      <Text style={styles.whatIfLine}>
        Tiempo: {formatSigned(whatIf.estimatedExtraTime, "min")}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function DecisionInspectorModal({ visible, orderId, onClose }) {
  const [isLoading, setIsLoading] = useState(true);
  const [order, setOrder] = useState(null);
  const [decisionsByAgent, setDecisionsByAgent] = useState({});

  useEffect(() => {
    if (!visible || !orderId) return;

    setIsLoading(true);
    getOrderDecisionsRequest(orderId)
      .then((data) => {
        setOrder(data.order);
        const byAgent = {};
        data.decisions.forEach((d) => {
          byAgent[d.agent_code] = d;
        });
        setDecisionsByAgent(byAgent);
      })
      .catch(() => {
        setOrder(null);
        setDecisionsByAgent({});
      })
      .finally(() => setIsLoading(false));
  }, [visible, orderId]);

  const baseline = decisionsByAgent.BASELINE;
  const smart = decisionsByAgent.SMARTCOURIER;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Decision Inspector</Text>
            <Pressable onPress={onClose} style={styles.closeButtonHitArea} hitSlop={8}>
              <Text style={styles.closeButton}>✕</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator style={styles.loading} size="large" />
          ) : !order ? (
            <Text style={styles.emptyText}>No se pudo cargar este pedido</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={styles.sectionTitle}>INFORMACIÓN DEL PEDIDO</Text>
              <View style={styles.card}>
                <InfoRow label="Pedido" value={`#${order.external_order_number} — ${order.merchant_name}`} />
                <InfoRow label="Pago" value={`$${order.final_payment}`} />
                <InfoRow
                  label="Recolección"
                  value={`${Number(order.pickup_lat).toFixed(4)}, ${Number(order.pickup_lng).toFixed(4)}`}
                />
                <InfoRow
                  label="Destino"
                  value={`${Number(order.dropoff_lat).toFixed(4)}, ${Number(order.dropoff_lng).toFixed(4)}`}
                />
                <InfoRow label="Distancia" value={`${order.distance_km} km`} />
                <InfoRow label="Tiempo estimado" value={`${order.estimated_time_minutes} min`} />
                <InfoRow label="Tráfico" value={order.traffic_level} />
                <InfoRow label="Surge" value={`x${order.surge_multiplier}`} />
              </View>

              <Text style={styles.sectionTitle}>BASELINE</Text>
              <View style={styles.card}>
                <DecisionBadge decision={baseline?.decision} />
                <ReasonsList reasons={baseline?.reasons} />
              </View>

              <Text style={styles.sectionTitle}>SMARTCOURIER AI</Text>
              <View style={styles.card}>
                <DecisionBadge decision={smart?.decision} />
                {smart?.score !== undefined && smart?.score !== null && (
                  <Text style={styles.scoreText}>Score: {smart.score}/100</Text>
                )}
                <RestrictionsText restrictions={smart?.restrictions} />
                <ReasonsList reasons={smart?.positive_factors} />
                <ReasonsList reasons={smart?.negative_factors} />
                {smart?.decision === "BATCH" && smart?.estimated_impact && (
                  <View style={styles.batchImpact}>
                    <Text style={styles.batchImpactTitle}>Agrupado con el pedido activo:</Text>
                    <InfoRow
                      label="Distancia adicional"
                      value={`+${smart.estimated_impact.additionalDistance} km`}
                    />
                    <InfoRow
                      label="Tiempo adicional"
                      value={`+${smart.estimated_impact.additionalTime} min`}
                    />
                    <InfoRow
                      label="Ganancia adicional"
                      value={`+$${smart.estimated_impact.additionalRevenue}`}
                    />
                  </View>
                )}
              </View>

              <Text style={styles.sectionTitle}>¿QUÉ HABRÍA PASADO SI...?</Text>
              <View style={styles.card}>
                <WhatIfBlock order={order} decision={baseline?.decision} label="BASELINE" />
                <WhatIfBlock order={order} decision={smart?.decision} label="SMARTCOURIER" />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#f5f5f5",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "85%",
    minHeight: "50%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },
  closeButtonHitArea: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    fontSize: 18,
    color: TEXT_COLORS.muted,
  },
  loading: {
    marginTop: 40,
  },
  emptyText: {
    textAlign: "center",
    color: TEXT_COLORS.muted,
    marginTop: 40,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  infoLabel: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: "600",
    color: TEXT_COLORS.primary,
  },
  scoreText: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    marginTop: 4,
  },
  batchImpact: {
    marginTop: 8,
    backgroundColor: "#f3e5f5",
    borderRadius: 8,
    padding: 8,
  },
  batchImpactTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: DECISION_COLORS.BATCH,
    marginBottom: 4,
  },
  whatIfBlock: {
    marginBottom: 12,
  },
  whatIfAgent: {
    fontSize: 12,
    fontWeight: "700",
  },
  whatIfAlternative: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    fontStyle: "italic",
    marginBottom: 2,
  },
  whatIfLine: {
    fontSize: 12,
    color: TEXT_COLORS.primary,
  },
});
