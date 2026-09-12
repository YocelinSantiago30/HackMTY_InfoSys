import { io } from "socket.io-client";
import { API_BASE_URL } from "../constants/config";

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io(API_BASE_URL, { transports: ["websocket"], autoConnect: false });
  }
  return socket;
}

export function joinSimulation(simulationId, token) {
  return new Promise((resolve, reject) => {
    const s = getSocket();

    function attemptJoin() {
      s.emit("join_simulation", { simulationId, token }, (ack) => {
        if (ack?.status === "OK") {
          resolve(s);
        } else {
          reject(new Error(ack?.message || "No se pudo unir a la simulación"));
        }
      });
    }

    if (s.connected) {
      attemptJoin();
    } else {
      s.connect();
      s.once("connect", attemptJoin);
    }
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}

export function getActiveSocket() {
  return socket;
}
