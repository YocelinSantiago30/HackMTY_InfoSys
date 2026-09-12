import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import LeafletMap from "../components/LeafletMap";

// Monterrey, NL — se usa si el usuario no otorga permiso de ubicación
// o si el dispositivo no puede obtenerla.
const MONTERREY_FALLBACK = { latitude: 25.6866, longitude: -100.3161 };

export default function MapScreen() {
  const mapRef = useRef(null);
  const [initialPosition, setInitialPosition] = useState(null);
  const [locationWarning, setLocationWarning] = useState(null);

  useEffect(() => {
    let watchSubscription;

    async function setupLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setLocationWarning("Sin permiso de ubicación — mostrando Monterrey");
        setInitialPosition(MONTERREY_FALLBACK);
        return;
      }

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        setInitialPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        watchSubscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 20 },
          (update) => {
            mapRef.current?.setCourierPosition(
              update.coords.latitude,
              update.coords.longitude
            );
          }
        );
      } catch (error) {
        setLocationWarning("No se pudo obtener tu ubicación — mostrando Monterrey");
        setInitialPosition(MONTERREY_FALLBACK);
      }
    }

    setupLocation();

    return () => {
      watchSubscription?.remove();
    };
  }, []);

  if (!initialPosition) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {locationWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{locationWarning}</Text>
        </View>
      )}
      <LeafletMap
        ref={mapRef}
        latitude={initialPosition.latitude}
        longitude={initialPosition.longitude}
        markerLabel="Tú"
      />
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
  warningBanner: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 8,
  },
  warningText: {
    color: "#856404",
    fontSize: 12,
    textAlign: "center",
  },
});
