import { Platform } from "react-native";

// En un dispositivo físico con Expo Go, "localhost" apunta al propio
// teléfono, no a esta computadora. Si pruebas en un dispositivo real,
// reemplaza esta URL por la IP de tu red local (ej. `ipconfig getifaddr en0`
// en macOS), manteniendo el puerto 5001.
export const API_BASE_URL = Platform.select({
  web: "http://localhost:5001",
  android: "http://10.0.2.2:5001", // emulador Android -> localhost del host
  default: "http://localhost:5001", // simulador iOS comparte red con el host
});
