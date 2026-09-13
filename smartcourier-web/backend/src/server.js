require("dotenv").config();

const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const initSocket = require("./socket");
const simulationService = require("./services/simulation.service");

const PORT = process.env.PORT || 5001;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, async () => {
  logger.log("SERVER", `Servidor corriendo en http://localhost:${PORT}`);
  try {
    await simulationService.markInterruptedSimulations();
  } catch (error) {
    logger.error(`No se pudieron marcar simulaciones interrumpidas: ${error.message}`);
  }
});
