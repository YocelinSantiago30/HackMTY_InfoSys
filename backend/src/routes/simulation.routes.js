const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authMiddleware = require("../middlewares/auth.middleware");
const simulationController = require("../controllers/simulation.controller");

const router = Router();

router.use(authMiddleware);

router.post("/", asyncHandler(simulationController.createSimulation));
router.get("/", asyncHandler(simulationController.listSimulations));
router.get("/:id", asyncHandler(simulationController.getSimulation));
router.get("/:id/orders", asyncHandler(simulationController.listOrders));
router.get("/:id/comparison", asyncHandler(simulationController.getComparison));
router.post("/:id/start", asyncHandler(simulationController.startSimulation));
router.post("/:id/pause", asyncHandler(simulationController.pauseSimulation));
router.post("/:id/resume", asyncHandler(simulationController.resumeSimulation));
router.post("/:id/stop", asyncHandler(simulationController.stopSimulation));
router.post("/:id/events", asyncHandler(simulationController.injectEvent));

module.exports = router;
