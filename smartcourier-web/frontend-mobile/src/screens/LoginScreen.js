import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";
import { AGENT_COLORS, MIN_TOUCH_TARGET, TEXT_COLORS } from "../constants/theme";

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    setError(null);

    if (!email || !password) {
      setError("Ingresa tu correo y contraseña");
      return;
    }

    setIsSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.response?.data?.message || "No se pudo iniciar sesión");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Ionicons
        name="bicycle"
        size={40}
        color={AGENT_COLORS.SMARTCOURIER}
        style={styles.titleIcon}
      />
      <Text style={styles.title}>SmartCourier AI</Text>

      <TextInput
        style={styles.input}
        placeholder="Correo electrónico"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={isSubmitting}
      >
        <Text style={styles.buttonText}>
          {isSubmitting ? "Ingresando..." : "Iniciar sesión"}
        </Text>
      </Pressable>

      <Pressable style={styles.linkButton} onPress={() => navigation.navigate("Register")}>
        <Text style={styles.link}>Crear cuenta</Text>
      </Pressable>

      <Pressable
        style={styles.linkButton}
        onPress={() => Alert.alert("SmartCourier AI", "Función no disponible aún")}
      >
        <Text style={styles.linkMuted}>¿Olvidaste tu contraseña?</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  titleIcon: {
    alignSelf: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: {
    color: "#d32f2f",
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: AGENT_COLORS.SMARTCOURIER,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
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
  linkButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  link: {
    color: AGENT_COLORS.SMARTCOURIER,
    textAlign: "center",
    marginTop: 8,
    fontSize: 15,
  },
  linkMuted: {
    color: TEXT_COLORS.muted,
    textAlign: "center",
    fontSize: 13,
  },
});
