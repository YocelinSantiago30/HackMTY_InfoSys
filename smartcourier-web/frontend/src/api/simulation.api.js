import client from "./client";

export async function createSimulationRequest(options) {
  const { data } = await client.post("/api/simulations", options);
  return data.simulation;
}

export async function listSimulationsRequest() {
  const { data } = await client.get("/api/simulations");
  return data.simulations;
}

export async function getSimulationRequest(simulationId) {
  const { data } = await client.get(`/api/simulations/${simulationId}`);
  return data.simulation;
}

export async function startSimulationRequest(simulationId) {
  // Initial OSRM route generation can exceed a normal request; keep a bounded wait.
  const { data } = await client.post(`/api/simulations/${simulationId}/start`, {}, { timeout: 60000 });
  return data.simulation;
}

export async function pauseSimulationRequest(simulationId) {
  const { data } = await client.post(`/api/simulations/${simulationId}/pause`);
  return data.simulation;
}

export async function resumeSimulationRequest(simulationId) {
  const { data } = await client.post(`/api/simulations/${simulationId}/resume`);
  return data.simulation;
}

export async function stopSimulationRequest(simulationId) {
  const { data } = await client.post(`/api/simulations/${simulationId}/stop`);
  return data.simulation;
}

export async function setSpeedRequest(simulationId, speed) {
  const { data } = await client.post(`/api/simulations/${simulationId}/speed`, { speed });
  return data.simulation;
}

export async function getComparisonRequest(simulationId) {
  const { data } = await client.get(`/api/simulations/${simulationId}/comparison`);
  return data;
}

export async function injectEventRequest(simulationId, eventType, payload = {}) {
  const { data } = await client.post(`/api/simulations/${simulationId}/events`, { eventType, payload });
  return data;
}
