const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authMiddleware = require("../middlewares/auth.middleware");
const historyController = require("../controllers/history.controller");

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(historyController.getHistory));

module.exports = router;
