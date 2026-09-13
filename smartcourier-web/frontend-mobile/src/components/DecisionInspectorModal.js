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
import { Ionicons } from "@expo/vector-icons";
import { getOrderDecisionsRequest } from "../api/order.api";
import { DecisionBadge, ReasonsList, RestrictionsText } from "./decisionDisplay";
import { DECISION_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

// "¿Qué habría pasado si...?" (sección 9) con la economía real que el motor
// calculó para ese agente en ese momento (trayecto al pickup + entrega +
// costo operativo), no solo con el pago del pedido. Solo existe cuando el
// agente evaluó la ruta completa (SmartCourier libre, o cualquier ACCEPT).
function computeWhatIf(impact, decision) {
  if (!impact || impact.netProfit === undefined) return null;
  const sign = decision === "ACCEPT" ? -1 : 1;

  return {
    alternative: decision === "ACCEPT" ? "Si hubiera RECHAZADO" : "Si hubiera ACEPTADO",
    estimatedProfitImpact: sign * impact.netProfit,
    estimatedExtraDistance: sign * impact.totalKm,
    estimatedExtraTime: sign * impact.totalMinutes,
  };
}

// Contrafactual de SmartCourier: no es solo "el mismo pedido con el signo
// cambiado", sino el valor simulado de aceptar y de seguir libre desde el
// mismo estado, con su rango entre escenarios.
function LookaheadBlock({ lookahead, decision }) {
  if (!lookahead) return null;
  const range = (stats) => `$${stats.mean.toFixed(2)} (p10 $${stats.p10.toFixed(0)} – p90 $${stats.p90.toFixed(0)})`;

  return (
    <View style={styles.whatIfBlock}>
      <Text style={styles.whatIfAgent}>SMARTCOURIER</Text>
      <Text style={styles.whatIfAlternative}>
        {lookahead.scenarios} escenarios de demanda de {lookahead.horizonMinutes} min desde el mismo estado
        (costo de oportunidad ${lookahead.opportunityCostPerMinute}/min extra):
      </Text>
      <Text style={styles.whatIfLine}>Aceptar: {range(lookahead.accept)}</Text>
      <Text style={styles.whatIfLine}>Esperar: {range(lookahead.wait)}</Text>
      <Text style={styles.whatIfLine}>
        Ventaja de aceptar: {formatSigned(lookahead.acceptAdvantage, "")} (p10 {formatSigned(lookahead.advantageP10, "")}, p90{" "}
        {formatSigned(lookahead.advantageP90, "")}) → {decision}
      </Text>
    </View>
  );
}

function formatSigned(value, unit) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

function WhatIfBlock({ impact, decision, label }) {
  if (!decision || decision === "BATCH" || decision === "REPOSITION" || decision === "REROUTE") {
    return null;
  }

  const whatIf = computeWhatIf(impact, decision);
  if (!whatIf) return null;

  return (
    <View style={styles.whatIfBlock}>
      <Text style={styles.whatIfAgent}>{label}</Text>
      <Text style={styles.whatIfAlternative}>{whatIf.alternative}:</Text>
      <Text style={styles.whatIfLine}>
        Ganancia neta: {formatSigned(whatIf.estimatedProfitImpact, "")}
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
              <Ionicons name="close" size={22} color={TEXT_COLORS.muted} />
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
                <RestrictionsText restrictions={baseline?.restrictions} />
                <ReasonsList reasons={baseline?.reasons} />
              </View>

              <Text style={styles.sectionTitle}>SMARTCOURIER AI</Text>
              <View style={styles.card}>
                <DecisionBadge decision={smart?.decision} />
                {smart?.score !== undefined && smart?.score !== null && (
                  <Text style={styles.scoreText}>Score: {smart.score}/100</Text>
                )}
                {smart?.estimated_impact?.netProfit !== undefined && (
                  <View style={styles.batchImpact}>
                    <InfoRow label="Distancia al pickup" value={`${smart.estimated_impact.distanceToPickupKm} km`} />
                    <InfoRow label="Distancia de entrega" value={`${smart.estimated_impact.deliveryDistanceKm} km`} />
                    <InfoRow label="Tiempo total" value={`${smart.estimated_impact.totalMinutes} min`} />
                    <InfoRow label="Costo operativo" value={`$${smart.estimated_impact.operatingCost}`} />
                    <InfoRow label="Ganancia neta" value={`$${smart.estimated_impact.netProfit}`} />
                    <InfoRow label="Ganancia/min" value={`$${smart.estimated_impact.profitPerMinute}`} />
                    <InfoRow label="Ganancia/km" value={`$${smart.estimated_impact.profitPerKm}`} />
                  </View>
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
                      label="Pago adicional"
                      value={`+$${smart.estimated_impact.additionalRevenue}`}
                    />
                    <InfoRow
                      label="Ganancia neta adicional"
                      value={`+$${smart.estimated_impact.additionalNetProfit}`}
                    />
                    <InfoRow
                      label="Retraso vs hora comprometida"
                      value={`${smart.estimated_impact.maxLateMinutesVsPromise} min`}
                    />
                  </View>
                )}
              </View>

              <Text style={styles.sectionTitle}>¿QUÉ HABRÍA PASADO SI...?</Text>
              <View style={styles.card}>
                <WhatIfBlock impact={baseline?.estimated_impact} decision={baseline?.decision} label="BASELINE" />
                {smart?.estimated_impact?.lookahead ? (
                  <LookaheadBlock lookahead={smart.estimated_impact.lookahead} decision={smart.decision} />
                ) : (
                  <WhatIfBlock impact={smart?.estimated_impact} decision={smart?.decision} label="SMARTCOURIER" />
                )}
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
