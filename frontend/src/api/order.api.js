import client from "./client";

export async function getOrderDecisionsRequest(orderId) {
  const { data } = await client.get(`/api/orders/${orderId}/decisions`);
  return data;
}
