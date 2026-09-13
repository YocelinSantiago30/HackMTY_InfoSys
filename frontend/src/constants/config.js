import { Platform } from "react-native";
import Constants from "expo-constants";

const BACKEND_PORT = 5001;

// En un teléfono con Expo Go, "localhost" es el propio teléfono. Durante el
// desarrollo, Expo informa desde qué computadora sirvió la app (hostUri,
// p. ej. "10.155.75.139:8081"): el backend corre en esa misma máquina, así que
// se usa su IP. Si la computadora cambia de red, la app lo sigue sola.
function devServerHost() {
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? hostUri.split(":")[0] : null;
}

// Para compilaciones sin servidor de desarrollo: EXPO_PUBLIC_API_URL.
const explicitUrl = process.env.EXPO_PUBLIC_API_URL;

export const API_BASE_URL =
  explicitUrl ||
  Platform.select({
    web: `http://localhost:${BACKEND_PORT}`,
    default: devServerHost() ? `http://${devServerHost()}:${BACKEND_PORT}` : `http://localhost:${BACKEND_PORT}`,
  });

export const REQUEST_TIMEOUT_MS = 10000;

