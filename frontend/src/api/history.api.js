import client from "./client";

export async function getHistoryRequest(filters = {}) {
  const params = {};
  if (filters.agent) params.agent = filters.agent;
  if (filters.decision) params.decision = filters.decision;
  if (filters.simulationId) params.simulationId = filters.simulationId;

  const { data } = await client.get("/api/history", { params });
  return data;
}
