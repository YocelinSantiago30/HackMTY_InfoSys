const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const routingController = require("../controllers/routing.controller");

const router = Router();

router.post("/route", asyncHandler(routingController.getRoute));

module.exports = router;
