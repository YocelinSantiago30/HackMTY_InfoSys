const simulationService = require("../services/simulation.service");

async function createSimulation(req, res) {
  const simulation = await simulationService.createSimulation(req.user.id, req.body);
  res.status(201).json({ simulation });
}

async function listSimulations(req, res) {
  const { limit, offset } = req.query;
  const simulations = await simulationService.listSimulations(req.user.id, { limit, offset });
  res.json({ simulations });
}

async function getSimulation(req, res) {
  const simulation = await simulationService.getSimulation(req.user.id, req.params.id);
  res.json({ simulation });
}

async function startSimulation(req, res) {
  const simulation = await simulationService.startSimulation(req.user.id, req.params.id);
  res.json({ simulation });
}

async function pauseSimulation(req, res) {
  const simulation = await simulationService.pauseSimulation(req.user.id, req.params.id);
  res.json({ simulation });
}

async function resumeSimulation(req, res) {
  const simulation = await simulationService.resumeSimulation(req.user.id, req.params.id);
  res.json({ simulation });
}

async function stopSimulation(req, res) {
  const simulation = await simulationService.stopSimulation(req.user.id, req.params.id);
  res.json({ simulation });
}

async function setSpeed(req, res) {
  const simulation = await simulationService.setSpeed(req.user.id, req.params.id, Number(req.body.speed));
  res.json({ simulation });
}

async function listOrders(req, res) {
  const orders = await simulationService.listOrders(req.user.id, req.params.id);
  res.json({ orders });
}

async function getComparison(req, res) {
  const comparison = await simulationService.getComparison(req.user.id, req.params.id);
  res.json(comparison);
}

async function injectEvent(req, res) {
  const { eventType, payload } = req.body;
  const result = await simulationService.injectEvent(req.user.id, req.params.id, eventType, payload);
  res.status(201).json(result);
}

module.exports = {
  createSimulation,
  listSimulations,
  getSimulation,
  startSimulation,
  pauseSimulation,
  resumeSimulation,
  stopSimulation,
  setSpeed,
  listOrders,
  getComparison,
  injectEvent,
};
