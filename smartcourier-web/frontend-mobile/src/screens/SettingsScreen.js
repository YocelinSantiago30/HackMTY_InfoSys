import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";
import LabeledInput from "../components/LabeledInput";
import { AGENT_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";
import {
  getPreferencesRequest,
  updatePreferencesRequest,
  updateProfileRequest,
} from "../api/user.api";

const VEHICLE_OPTIONS = [
  { value: "bike", label: "Bicicleta" },
  { value: "motorcycle", label: "Motocicleta" },
  { value: "car", label: "Auto" },
];

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toDisplayString(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toNumberOrNull(text) {
  if (text.trim() === "") return null;
  const num = Number(text);
  return Number.isNaN(num) ? null : num;
}

function preferencesToFormState(preferences) {
  return {
    vehicleType: preferences.vehicle_type || "",
    bagHeight: toDisplayString(preferences.bag_height),
    bagWidth: toDisplayString(preferences.bag_width),
    bagDepth: toDisplayString(preferences.bag_depth),
    bagMaxWeight: toDisplayString(preferences.bag_max_weight),
    bagCapacity: toDisplayString(preferences.bag_capacity),
    workZoneCenterLat: toDisplayString(preferences.work_zone_center_lat),
    workZoneCenterLng: toDisplayString(preferences.work_zone_center_lng),
    workZoneRadiusKm: toDisplayString(preferences.work_zone_radius_km),
    shiftStartTime: (preferences.shift_start_time || "").slice(0, 5),
    shiftEndTime: (preferences.shift_end_time || "").slice(0, 5),
    minimumPayment: toDisplayString(preferences.minimum_payment),
    minimumPaymentPerMinute: toDisplayString(preferences.minimum_payment_per_minute),
    minimumPaymentPerKm: toDisplayString(preferences.minimum_payment_per_km),
    maximumDistanceKm: toDisplayString(preferences.maximum_distance_km),
    avoidConfiguredZones: Boolean(preferences.avoid_configured_zones),
    nightDistanceLimitKm: toDisplayString(preferences.night_distance_limit_km),
    preferredZonesCount: (preferences.preferred_zones || []).length,
    avoidedZonesCount: (preferences.avoided_zones || []).length,
  };
}

export default function SettingsScreen() {
  const { user, logout, updateUserLocal } = useAuth();

  const [name, setName] = useState(user?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [form, setForm] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  async function loadPreferences() {
    try {
      const preferences = await getPreferencesRequest();
      setForm(preferencesToFormState(preferences));
    } catch (error) {
      Alert.alert("Error", "No se pudieron cargar tus preferencias");
    } finally {
      setIsLoading(false);
    }
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveProfile() {
    if (!name.trim()) {
      Alert.alert("SmartCourier AI", "El nombre no puede estar vacío");
      return;
    }

    setSavingProfile(true);

    try {
      const profile = await updateProfileRequest(name.trim());
      updateUserLocal({ name: profile.name });
      Alert.alert("SmartCourier AI", "Perfil actualizado");
    } catch (error) {
      Alert.alert("Error", error.response?.data?.message || "No se pudo actualizar el perfil");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSavePreferences() {
    if (form.shiftStartTime && !TIME_REGEX.test(form.shiftStartTime)) {
      Alert.alert("SmartCourier AI", "Hora de inicio inválida (usa HH:MM)");
      return;
    }

    if (form.shiftEndTime && !TIME_REGEX.test(form.shiftEndTime)) {
      Alert.alert("SmartCourier AI", "Hora de fin inválida (usa HH:MM)");
      return;
    }

    setSavingPreferences(true);

    try {
      const updated = await updatePreferencesRequest({
        vehicle_type: form.vehicleType || null,
        bag_height: toNumberOrNull(form.bagHeight),
        bag_width: toNumberOrNull(form.bagWidth),
        bag_depth: toNumberOrNull(form.bagDepth),
        bag_max_weight: toNumberOrNull(form.bagMaxWeight),
        bag_capacity: toNumberOrNull(form.bagCapacity),
        work_zone_center_lat: toNumberOrNull(form.workZoneCenterLat),
        work_zone_center_lng: toNumberOrNull(form.workZoneCenterLng),
        work_zone_radius_km: toNumberOrNull(form.workZoneRadiusKm),
        shift_start_time: form.shiftStartTime || null,
        shift_end_time: form.shiftEndTime || null,
        minimum_payment: toNumberOrNull(form.minimumPayment),
        minimum_payment_per_minute: toNumberOrNull(form.minimumPaymentPerMinute),
        minimum_payment_per_km: toNumberOrNull(form.minimumPaymentPerKm),
        maximum_distance_km: toNumberOrNull(form.maximumDistanceKm),
        avoid_configured_zones: form.avoidConfiguredZones,
        night_distance_limit_km: toNumberOrNull(form.nightDistanceLimitKm),
      });
      setForm(preferencesToFormState(updated));
      Alert.alert("SmartCourier AI", "Preferencias guardadas");
    } catch (error) {
      Alert.alert("Error", error.response?.data?.message || "No se pudieron guardar las preferencias");
    } finally {
      setSavingPreferences(false);
    }
  }

  if (isLoading || !form) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>PERFIL</Text>
      <View style={styles.card}>
        <LabeledInput label="Nombre" value={name} onChangeText={setName} />
        <Text style={styles.readonlyLabel}>Correo</Text>
        <Text style={styles.readonlyValue}>{user?.email}</Text>
        <Pressable
          style={[styles.button, savingProfile && styles.buttonDisabled]}
          onPress={handleSaveProfile}
          disabled={savingProfile}
        >
          <Text style={styles.buttonText}>
            {savingProfile ? "Guardando..." : "Guardar perfil"}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>VEHÍCULO</Text>
      <View style={styles.card}>
        <View style={styles.segmentedControl}>
          {VEHICLE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.segment,
                form.vehicleType === option.value && styles.segmentActive,
              ]}
              onPress={() => setField("vehicleType", option.value)}
            >
              <Text
                style={[
                  styles.segmentText,
                  form.vehicleType === option.value && styles.segmentTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>MOCHILA</Text>
      <View style={styles.card}>
        <LabeledInput
          label="Altura (cm)"
          value={form.bagHeight}
          onChangeText={(v) => setField("bagHeight", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Ancho (cm)"
          value={form.bagWidth}
          onChangeText={(v) => setField("bagWidth", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Profundidad (cm)"
          value={form.bagDepth}
          onChangeText={(v) => setField("bagDepth", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Peso máximo (kg)"
          value={form.bagMaxWeight}
          onChangeText={(v) => setField("bagMaxWeight", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Capacidad (L)"
          value={form.bagCapacity}
          onChangeText={(v) => setField("bagCapacity", v)}
          keyboardType="numeric"
        />
      </View>

      <Text style={styles.sectionTitle}>ZONA DE TRABAJO</Text>
      <View style={styles.card}>
        <LabeledInput
          label="Centro - Latitud"
          value={form.workZoneCenterLat}
          onChangeText={(v) => setField("workZoneCenterLat", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Centro - Longitud"
          value={form.workZoneCenterLng}
          onChangeText={(v) => setField("workZoneCenterLng", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Radio (km)"
          value={form.workZoneRadiusKm}
          onChangeText={(v) => setField("workZoneRadiusKm", v)}
          keyboardType="numeric"
        />
        <Text style={styles.hint}>
          Zonas preferidas ({form.preferredZonesCount}) y evitadas ({form.avoidedZonesCount}):
          se dibujan sobre el mapa en la FASE 8.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>TURNO</Text>
      <View style={styles.card}>
        <LabeledInput
          label="Hora de inicio (HH:MM)"
          value={form.shiftStartTime}
          onChangeText={(v) => setField("shiftStartTime", v)}
          placeholder="08:00"
        />
        <LabeledInput
          label="Hora de fin (HH:MM)"
          value={form.shiftEndTime}
          onChangeText={(v) => setField("shiftEndTime", v)}
          placeholder="17:00"
        />
      </View>

      <Text style={styles.sectionTitle}>PREFERENCIAS ECONÓMICAS</Text>
      <View style={styles.card}>
        <LabeledInput
          label="Pago mínimo ($)"
          value={form.minimumPayment}
          onChangeText={(v) => setField("minimumPayment", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Pago mínimo por minuto ($/min)"
          value={form.minimumPaymentPerMinute}
          onChangeText={(v) => setField("minimumPaymentPerMinute", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Pago mínimo por km ($/km)"
          value={form.minimumPaymentPerKm}
          onChangeText={(v) => setField("minimumPaymentPerKm", v)}
          keyboardType="numeric"
        />
        <LabeledInput
          label="Distancia máxima (km)"
          value={form.maximumDistanceKm}
          onChangeText={(v) => setField("maximumDistanceKm", v)}
          keyboardType="numeric"
        />
      </View>

      <Text style={styles.sectionTitle}>SEGURIDAD</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Evitar zonas configuradas como riesgosas</Text>
          <Switch
            value={form.avoidConfiguredZones}
            onValueChange={(v) => setField("avoidConfiguredZones", v)}
          />
        </View>
        <LabeledInput
          label="Límite de distancia nocturna (km)"
          value={form.nightDistanceLimitKm}
          onChangeText={(v) => setField("nightDistanceLimitKm", v)}
          keyboardType="numeric"
        />
      </View>

      <Pressable
        style={[styles.button, savingPreferences && styles.buttonDisabled]}
        onPress={handleSavePreferences}
        disabled={savingPreferences}
      >
        <Text style={styles.buttonText}>
          {savingPreferences ? "Guardando..." : "Guardar preferencias"}
        </Text>
      </Pressable>

      <Pressable style={styles.logoutButton} onPress={logout}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: TEXT_COLORS.muted,
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
  },
  readonlyLabel: {
    fontSize: 13,
    color: TEXT_COLORS.secondary,
    marginBottom: 4,
  },
  readonlyValue: {
    fontSize: 15,
    color: TEXT_COLORS.primary,
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: TEXT_COLORS.muted,
    fontStyle: "italic",
    marginTop: 4,
  },
  segmentedControl: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AGENT_COLORS.SMARTCOURIER,
    alignItems: "center",
    justifyContent: "center",
    minHeight: MIN_TOUCH_TARGET,
  },
  segmentActive: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
  },
  segmentText: {
    color: AGENT_COLORS.SMARTCOURIER,
    fontWeight: "600",
    fontSize: 13,
  },
  segmentTextActive: {
    color: "#fff",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    marginRight: 12,
  },
  button: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    minHeight: MIN_TOUCH_TARGET,
  },
  logoutButton: {
    backgroundColor: "#d32f2f",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    minHeight: MIN_TOUCH_TARGET,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
