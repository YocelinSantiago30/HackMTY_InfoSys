const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const socketBus = require("./socketBus");
const logger = require("../utils/logger");

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  socketBus.setIo(io);

  io.on("connection", (socket) => {
    logger.event(`Socket conectado: ${socket.id}`);

    // El cliente se une a la sala de una simulación específica solo si
    // trae un JWT válido y es dueño de esa simulación — la misma regla de
    // ownership que ya aplican los endpoints REST (getOwnedSimulation).
    socket.on("join_simulation", async ({ simulationId, token }, callback) => {
      try {
        if (!token) throw new Error("Token no proporcionado");

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await pool.query(
          "SELECT user_id FROM simulation_sessions WHERE id = $1",
          [simulationId]
        );
        const simulation = result.rows[0];

        if (!simulation) throw new Error("Simulación no encontrada");
        if (simulation.user_id !== decoded.id) throw new Error("No tienes acceso a esta simulación");

        socket.join(`simulation:${simulationId}`);
        logger.event(`Socket ${socket.id} se unió a simulation:${simulationId}`);
        callback?.({ status: "OK" });
      } catch (error) {
        callback?.({ status: "ERROR", message: error.message });
      }
    });

    socket.on("leave_simulation", ({ simulationId } = {}) => {
      if (simulationId) socket.leave(`simulation:${simulationId}`);
    });

    socket.on("disconnect", () => {
      logger.event(`Socket desconectado: ${socket.id}`);
    });
  });

  return io;
}

module.exports = initSocket;
