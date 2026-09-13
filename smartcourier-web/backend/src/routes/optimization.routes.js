const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const optimizationController = require("../controllers/optimization.controller");

const router = Router();

router.post("/batch", asyncHandler(optimizationController.optimizeBatch));

module.exports = router;
