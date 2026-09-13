// Levanta el servicio Python del tier 2 (agente de estrategia) en un puerto
// propio para entrenar/evaluar sin tocar el servicio que esté usando la app.
const { spawn } = require("child_process");
const path = require("path");
const axios = require("axios");

const SERVICE_DIR = path.join(__dirname, "../../../optimization-service");

async function waitForHealth(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      await axios.get(`${url}/health`, { timeout: 500 });
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`El servicio de estrategia no respondió en ${url}`);
}

async function startModelService({ port = 8011, apiKey = "local-training-key" } = {}) {
  const child = spawn(path.join(SERVICE_DIR, "venv/bin/uvicorn"), ["main:app", "--port", String(port), "--log-level", "warning"], {
    cwd: SERVICE_DIR,
    env: { ...process.env, COURIER_MODEL_API_KEY: apiKey },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);
  return {
    url,
    apiKey,
    stop: () => new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
    }),
  };
}

module.exports = { startModelService };
