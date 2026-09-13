const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authMiddleware = require("../middlewares/auth.middleware");
const userController = require("../controllers/user.controller");

const router = Router();

router.use(authMiddleware);

router.get("/profile", asyncHandler(userController.getProfile));
router.put("/profile", asyncHandler(userController.updateProfile));
router.get("/preferences", asyncHandler(userController.getPreferences));
router.put("/preferences", asyncHandler(userController.updatePreferences));

module.exports = router;
