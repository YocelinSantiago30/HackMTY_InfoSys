import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "smartcourier-token";

// expo-secure-store solo existe en Android/iOS; en web su módulo está vacío y
// cualquier llamada lanza error. Ahí se usa localStorage (el navegador no
// ofrece un almacén cifrado equivalente).
const isWeb = Platform.OS === "web";

export async function saveToken(token) {
  if (isWeb) return window.localStorage.setItem(TOKEN_KEY, token);
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken() {
  if (isWeb) return window.localStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function removeToken() {
  if (isWeb) return window.localStorage.removeItem(TOKEN_KEY);
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}
