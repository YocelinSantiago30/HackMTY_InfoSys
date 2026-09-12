import client from "./client";

export async function registerRequest(name, email, password) {
  const { data } = await client.post("/api/auth/register", { name, email, password });
  return data;
}

export async function loginRequest(email, password) {
  const { data } = await client.post("/api/auth/login", { email, password });
  return data;
}

export async function meRequest() {
  const { data } = await client.get("/api/auth/me");
  return data;
}
