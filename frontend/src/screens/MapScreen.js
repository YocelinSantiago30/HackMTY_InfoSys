import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import LeafletMap from "../components/LeafletMap";
import { useSimulation } from "../contexts/SimulationContext";
import { AGENT_COLORS, AGENT_ICONS, TEXT_COLORS } from "../constants/theme";
import { formatShiftClock } from "../utils/shiftClock";

// Centro del área de servicio simulada (backend/src/simulation/OrderGenerator.js).
const MONTERREY = { latitude: 25.6866, longitude: -100.3161 };

const LOCATION_TIMEOUT_MS = 5000;

const AGENT_TITLES = { BASELINE: "Baseline", SMARTCOURIER: "SmartCourier" };

const STATUS_LABELS = {
  IDLE: "Libre, esperando pedido",
  TO_PICKUP: "Yendo a recoger",
  WAITING_PICKUP: "Esperando preparación",
  TO_DROPOFF: "Entregando",
  REPOSITIONING: "Reposicionándose",
};

function AgentRow({ agentCode, courier, route }) {
  const color = AGENT_COLORS[agentCode];
  const order = route?.orders?.[0];

  return (
    <View style={styles.agentRow}>
      <View style={styles.agentHeader}>
        <Ionicons name={AGENT_ICONS[agentCode]} size={14} color={color} />
        <Text style={[styles.agentTitle, { color }]}>{AGENT_TITLES[agentCode]}</Text>
        <Text style={styles.agentStatus}>{STATUS_LABELS[courier?.status] || "—"}</Text>
      </View>
      {order ? (
        <Text style={styles.orderLine} numberOfLines={1}>
          #{order.orderNumber} {order.merchantName} · ${order.finalPayment.toFixed(0)} · {order.distanceKm.toFixed(1)} km ·{" "}
          {order.routeSource === "ROUTED" ? "ruta OSRM" : "ruta estimada"}
          {route.orders.length > 1 ? ` · +${route.orders.length - 1} agrupado` : ""}
        </Text>
      ) : null}
      {order?.promisedSecond ? (
        <Text style={[styles.etaLine, order.etaSecond - order.promisedSecond > 60 && styles.etaLate]}>
          Llega {formatShiftClock(order.etaSecond)} · prometido {formatShiftClock(order.promisedSecond)}
          {order.etaSecond - order.promisedSecond > 60
            ? ` (+${Math.round((order.etaSecond - order.promisedSecond) / 60)} min)`
            : " (a tiempo)"}
        </Text>
      ) : null}
      {!order && <Text style={styles.orderLineMuted}>Sin pedido activo</Text>}
    </View>
  );
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const { simulation, couriers, routes } = useSimulation();
  const [userPosition, setUserPosition] = useState(null);
  const [locationReady, setLocationReady] = useState(false);
  const [mapError, setMapError] = useState(null);

  // Sin simulación, el mapa muestra la ubicación real del dispositivo.
  useEffect(() => {
    let subscription;
    let cancelled = false;

    async function setupLocation() {
      try {
        // Algunos navegadores (p. ej. el de VS Code) nunca responden al permiso
        // de ubicación: después de unos segundos se sigue sin ella.
        const withTimeout = (promise) =>
          Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), LOCATION_TIMEOUT_MS))]);

        const { status } = await withTimeout(Location.requestForegroundPermissionsAsync());
        if (status !== "granted") return;

        const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (cancelled) return;
        setUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude });

        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 20 },
          (update) => setUserPosition({ lat: update.coords.latitude, lng: update.coords.longitude })
        );
      } catch (error) {
        // sin ubicación: el mapa queda centrado en Monterrey
      } finally {
        if (!cancelled) setLocationReady(true);
      }
    }

    setupLocation();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // Al arrancar una simulación, el mapa se mueve al área de servicio aunque
  // estuviera centrado en la ubicación del usuario.
  useEffect(() => {
    if (simulation?.id) mapRef.current?.centerMap(MONTERREY.latitude, MONTERREY.longitude, 13);
  }, [simulation?.id]);

  if (!locationReady && !simulation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const hasSimulation = Boolean(simulation);
  const initialCenter = !hasSimulation && userPosition
    ? { latitude: userPosition.lat, longitude: userPosition.lng }
    : MONTERREY;

  return (
    <View style={styles.container}>
      <LeafletMap
        ref={mapRef}
        latitude={initialCenter.latitude}
        longitude={initialCenter.longitude}
        couriers={hasSimulation ? couriers : null}
        routes={hasSimulation ? routes : null}
        user={hasSimulation ? null : userPosition}
        onError={setMapError}
      />

      {(mapError || !hasSimulation) && (
        <View style={[styles.banner, { top: insets.top + 8 }]}>
          <Text style={styles.bannerText}>
            {mapError || "Inicia una simulación en Comparación para ver a los repartidores y sus rutas"}
          </Text>
        </View>
      )}

      {hasSimulation && (
        <View style={[styles.panel, { bottom: insets.bottom + 12 }]}>
          <AgentRow agentCode="SMARTCOURIER" courier={couriers.SMARTCOURIER} route={routes.SMARTCOURIER} />
          <View style={styles.divider} />
          <AgentRow agentCode="BASELINE" courier={couriers.BASELINE} route={routes.BASELINE} />
          <Text style={styles.legend}>P = recolección · D = entrega · punteado = reposicionamiento</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 8,
  },
  bannerText: {
    color: "#856404",
    fontSize: 12,
    textAlign: "center",
  },
  panel: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  agentRow: {
    gap: 2,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  agentTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  agentStatus: {
    fontSize: 12,
    color: TEXT_COLORS.secondary,
    marginLeft: "auto",
  },
  orderLine: {
    fontSize: 12,
    fontWeight: "600",
    color: TEXT_COLORS.primary,
  },
  etaLine: {
    fontSize: 11,
    color: "#2e7d32",
  },
  etaLate: {
    color: "#c62828",
  },
  orderLineMuted: {
    fontSize: 12,
    color: TEXT_COLORS.muted,
  },
  divider: {
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 8,
  },
  legend: {
    fontSize: 10,
    color: TEXT_COLORS.muted,
    marginTop: 8,
  },
});
