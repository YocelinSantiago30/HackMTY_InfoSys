const pool = require("../config/database");
const HttpError = require("../utils/httpError");

const PREFERENCE_FIELDS = [
  "vehicle_type",
  "bag_height",
  "bag_width",
  "bag_depth",
  "bag_max_weight",
  "bag_capacity",
  "work_zone_center_lat",
  "work_zone_center_lng",
  "work_zone_radius_km",
  "preferred_zones",
  "avoided_zones",
  "shift_start_time",
  "shift_end_time",
  "minimum_payment",
  "minimum_payment_per_minute",
  "minimum_payment_per_km",
  "maximum_distance_km",
  "avoid_configured_zones",
  "night_distance_limit_km",
];

const VEHICLE_TYPES = ["bike", "motorcycle", "car"];

async function getProfile(userId) {
  const result = await pool.query(
    "SELECT id, name, email, created_at FROM users WHERE id = $1",
    [userId]
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "Usuario no encontrado");
  }

  return result.rows[0];
}

async function updateProfile(userId, { name }) {
  if (!name || !name.trim()) {
    throw new HttpError(400, "El nombre no puede estar vacío");
  }

  const result = await pool.query(
    `UPDATE users SET name = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, name, email, created_at`,
    [name.trim(), userId]
  );

  return result.rows[0];
}

async function getPreferences(userId) {
  const existing = await pool.query(
    "SELECT * FROM user_preferences WHERE user_id = $1",
    [userId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await pool.query(
    "INSERT INTO user_preferences (user_id) VALUES ($1) RETURNING *",
    [userId]
  );

  return created.rows[0];
}

async function updatePreferences(userId, updates) {
  const entries = Object.entries(updates).filter(([key]) => PREFERENCE_FIELDS.includes(key));

  if (entries.length === 0) {
    throw new HttpError(400, "No se recibieron campos válidos para actualizar");
  }

  if (
    "vehicle_type" in updates &&
    updates.vehicle_type !== null &&
    !VEHICLE_TYPES.includes(updates.vehicle_type)
  ) {
    throw new HttpError(400, `vehicle_type debe ser uno de: ${VEHICLE_TYPES.join(", ")}`);
  }

  await getPreferences(userId); // asegura que la fila exista antes de actualizar

  const setClauses = entries.map(([key], index) => `${key} = $${index + 2}`);
  const values = entries.map(([, value]) => value);

  const result = await pool.query(
    `UPDATE user_preferences
     SET ${setClauses.join(", ")}, updated_at = now()
     WHERE user_id = $1
     RETURNING *`,
    [userId, ...values]
  );

  return result.rows[0];
}

module.exports = {
  getProfile,
  updateProfile,
  getPreferences,
  updatePreferences,
};
