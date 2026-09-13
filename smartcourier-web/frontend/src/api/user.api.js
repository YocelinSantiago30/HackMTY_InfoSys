import client from "./client";

export async function getProfileRequest() {
  const { data } = await client.get("/api/user/profile");
  return data.profile;
}

export async function updateProfileRequest(name) {
  const { data } = await client.put("/api/user/profile", { name });
  return data.profile;
}

export async function getPreferencesRequest() {
  const { data } = await client.get("/api/user/preferences");
  return data.preferences;
}

export async function updatePreferencesRequest(updates) {
  const { data } = await client.put("/api/user/preferences", updates);
  return data.preferences;
}
