require("dotenv").config();

const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const initSocket = require("./socket");

const PORT = process.env.PORT || 5001;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  logger.log("SERVER", `Servidor corriendo en http://localhost:${PORT}`);
});
