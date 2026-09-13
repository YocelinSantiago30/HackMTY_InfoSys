import axios from "axios";
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../constants/config";

// Sin timeout, un backend inalcanzable dejaba los botones "procesando" para siempre.
const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      error.response = {
        data: { message: `No se pudo conectar con el servidor (${API_BASE_URL}). Revisa que el backend esté corriendo y en la misma red.` },
      };
    }
    return Promise.reject(error);
  }
);

export function setAuthToken(token) {
  if (token) {
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete client.defaults.headers.common.Authorization;
  }
}

export default client;
