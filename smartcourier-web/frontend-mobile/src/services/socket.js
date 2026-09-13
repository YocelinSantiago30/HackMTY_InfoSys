import { io } from "socket.io-client";
import { API_BASE_URL } from "../constants/config";

const CONNECT_TIMEOUT_MS = 8000;

let socket = null;
// Sala activa: si el socket se reconecta (el servidor se reinició y perdió
// las salas), se vuelve a unir automáticamente.
let activeJoin = null;

function getSocket() {
  if (!socket) {
    // "websocket" a secas falla en silencio en redes restrictivas (proxies
    // de eventos/universidades que bloquean el upgrade a WebSocket pero
    // permiten HTTP normal). Con ["polling", "websocket"], socket.io
    // arranca por HTTP polling y sube a WebSocket solo si puede.
    socket = io(API_BASE_URL, {
      transports: ["polling", "websocket"],
      autoConnect: false,
    });
    socket.on("connect", () => {
      if (activeJoin) socket.emit("join_simulation", activeJoin);
    });
  }
  return socket;
}

export function joinSimulation(simulationId, token) {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("No se pudo conectar al servidor en tiempo real (tiempo de espera agotado)"));
    }, CONNECT_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutId);
      s.off("connect", attemptJoin);
      s.off("connect_error", onConnectError);
    }

    function attemptJoin() {
      s.emit("join_simulation", { simulationId, token }, (ack) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (ack?.status === "OK") {
          activeJoin = { simulationId, token };
          resolve(s);
        } else {
          reject(new Error(ack?.message || "No se pudo unir a la simulación"));
        }
      });
    }

    function onConnectError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`No se pudo conectar al servidor en tiempo real: ${error.message}`));
    }

    if (s.connected) {
      attemptJoin();
    } else {
      s.once("connect", attemptJoin);
      s.once("connect_error", onConnectError);
      s.connect();
    }
  });
}

export function leaveSimulation(simulationId) {
  if (activeJoin?.simulationId === simulationId) activeJoin = null;
  if (socket?.connected && simulationId) {
    socket.emit("leave_simulation", { simulationId });
  }
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}

export function getActiveSocket() {
  return socket;
}
