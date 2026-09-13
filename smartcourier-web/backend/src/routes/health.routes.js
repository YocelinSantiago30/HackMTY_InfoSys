const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const healthController = require("../controllers/health.controller");

const router = Router();

router.get("/health", healthController.getHealth);
router.get("/db-health", asyncHandler(healthController.getDbHealth));

module.exports = router;
