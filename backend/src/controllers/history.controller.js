const historyService = require("../services/history.service");

async function getHistory(req, res) {
  const { agent, decision, simulationId, limit, offset } = req.query;

  const result = await historyService.getHistory(req.user.id, {
    agent,
    decision,
    simulationId,
    limit,
    offset,
  });

  res.json(result);
}

module.exports = {
  getHistory,
};
