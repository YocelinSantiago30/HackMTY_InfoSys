const orderService = require("../services/order.service");

async function getOrderDecisions(req, res) {
  const result = await orderService.getDecisionsForOrder(req.params.orderId, req.user.id);
  res.json(result);
}

module.exports = {
  getOrderDecisions,
};
 