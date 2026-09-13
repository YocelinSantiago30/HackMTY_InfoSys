const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authMiddleware = require("../middlewares/auth.middleware");
const orderController = require("../controllers/order.controller");

const router = Router();

router.use(authMiddleware);
router.get("/:orderId/decisions", asyncHandler(orderController.getOrderDecisions));

module.exports = router;
