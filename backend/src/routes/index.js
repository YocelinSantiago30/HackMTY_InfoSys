const { Router } = require("express");
const healthRoutes = require("./health.routes");
const baselineRoutes = require("./baseline.routes");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const routingRoutes = require("./routing.routes");
const simulationRoutes = require("./simulation.routes");
const historyRoutes = require("./history.routes");
const orderRoutes = require("./order.routes");
const optimizationRoutes = require("./optimization.routes");
const courierRoutes = require("./courier.routes");

const router = Router();

router.use("/api", healthRoutes);
router.use("/api", baselineRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/user", userRoutes);
router.use("/api/routing", routingRoutes);
router.use("/api/simulations", simulationRoutes);
router.use("/api/history", historyRoutes);
router.use("/api/orders", orderRoutes);
router.use("/api/optimization", optimizationRoutes);
// Contrato de courier/decision_response_schema.json: los jueces llaman a
// /decide directamente, sin autenticación de la app.
router.use("/", courierRoutes);

module.exports = router;
