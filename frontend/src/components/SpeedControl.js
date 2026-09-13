import { Pressable, StyleSheet, Text, View } from "react-native";
import { SPEED_OPTIONS } from "../contexts/SimulationContext";
import { AGENT_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

// Solo acelera el reloj simulado (pedidos, movimiento, tiempos y mapa);
// ganancias y decisiones son idénticas a cualquier velocidad.
export default function SpeedControl({ speed, onChange, disabled }) {
  return (
    <View style={styles.row}>
      {SPEED_OPTIONS.map((option) => {
        const active = option === speed;
        return (
          <Pressable
            key={option}
            style={[styles.segment, active && styles.segmentActive, disabled && styles.disabled]}
            onPress={() => onChange(option)}
            disabled={disabled || active}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={`Velocidad ${option}x`}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option}x</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    backgroundColor: "#e3eaf3",
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 6,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
  },
  disabled: {
    opacity: 0.5,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_COLORS.secondary,
  },
  segmentTextActive: {
    color: "#fff",
  },
});
