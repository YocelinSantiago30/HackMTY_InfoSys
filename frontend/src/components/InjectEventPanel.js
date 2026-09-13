import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { injectEventRequest } from "../api/simulation.api";
import { EVENT_ICONS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

const ICON_COLOR = "#4527a0";

// Sección 45: botones del modo demo para disparar eventos manualmente
// durante una presentación en vivo.
const EVENT_BUTTONS = [
  { label: "Surge", eventType: "SURGE_STARTED", payload: { multiplier: 2.0 } },
  { label: "Cierre vial", eventType: "ROAD_CLOSED", payload: {} },
  { label: "Tráfico pesado", eventType: "TRAFFIC_INCREASED", payload: { level: "SEVERE" } },
  { label: "Pedido urgente", eventType: "URGENT_ORDER", payload: {} },
  { label: "Demanda baja", eventType: "LOW_DEMAND", payload: {} },
  { label: "Demanda alta", eventType: "HIGH_DEMAND", payload: {} },
];

export default function InjectEventPanel({ simulationId }) {
  const [pendingEventType, setPendingEventType] = useState(null);

  async function handleInject(button) {
    setPendingEventType(button.eventType);
    try {
      await injectEventRequest(simulationId, button.eventType, button.payload);
    } catch (error) {
      // el registro de eventos recientes en ComparisonScreen ya refleja
      // los que sí tuvieron éxito; uno fallido simplemente no aparece.
    } finally {
      setPendingEventType(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>INJECT EVENT</Text>
      <View style={styles.grid}>
        {EVENT_BUTTONS.map((button) => (
          <Pressable
            key={button.eventType}
            style={[styles.button, pendingEventType === button.eventType && styles.buttonPending]}
            onPress={() => handleInject(button)}
            disabled={pendingEventType !== null}
          >
            <Ionicons name={EVENT_ICONS[button.eventType]} size={15} color={ICON_COLOR} />
            <Text style={styles.buttonText}>{button.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ede7f6",
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  buttonPending: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "600",
    color: ICON_COLOR,
  },
});
