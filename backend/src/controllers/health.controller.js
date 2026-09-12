const pool = require("../config/database");

function getHealth(req, res) {
  res.json({
    status: "OK",
  });
}

async function getDbHealth(req, res) {
  const result = await pool.query("SELECT code, name FROM agents ORDER BY code");
  res.json({
    status: "OK",
    agents: result.rows,
  });
}

module.exports = {
  getHealth,
  getDbHealth,
};
