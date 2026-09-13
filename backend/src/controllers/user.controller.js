const userService = require("../services/user.service");

async function getProfile(req, res) {
  const profile = await userService.getProfile(req.user.id);
  res.json({ profile });
}

async function updateProfile(req, res) {
  const profile = await userService.updateProfile(req.user.id, req.body);
  res.json({ profile });
}

async function getPreferences(req, res) {
  const preferences = await userService.getPreferences(req.user.id);
  res.json({ preferences });
}

async function updatePreferences(req, res) {
  const preferences = await userService.updatePreferences(req.user.id, req.body);
  res.json({ preferences });
}

module.exports = {
  getProfile,
  updateProfile,
  getPreferences,
  updatePreferences,
};

