const { Router } = require("express");
const express = require("express");
const courierController = require("../controllers/courier.controller");

const router = Router();

router.post("/decide", courierController.decide);
router.get("/explain/:orderId", courierController.explain);
router.get("/status", courierController.status);
router.post("/shock", courierController.shock);
router.post("/shift/start", courierController.startShift);
router.post("/strategy/refresh", courierController.refreshStrategy);
router.post("/admin/model-credential", courierController.setModelCredential);
router.post("/replay", express.text({ type: "*/*", limit: "20mb" }), courierController.replay);

module.exports = router;
