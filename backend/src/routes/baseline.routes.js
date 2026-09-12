const { Router } = require("express");
const baselineController = require("../controllers/baseline.controller");

const router = Router();

router.post("/evaluar-baseline", baselineController.evaluarBaseline);

module.exports = router;
