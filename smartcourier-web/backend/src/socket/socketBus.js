// Desacopla al resto del backend (SimulationEngine)
// de Socket.IO: solo llaman a emitToSimulation, sin conocer la instancia
// de `io` ni el nombre de la sala.
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function emitToSimulation(simulationId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(`simulation:${simulationId}`).emit(event, payload);
}

module.exports = {
  setIo,
  emitToSimulation,
};
