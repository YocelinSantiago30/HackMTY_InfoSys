const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const HttpError = require("../utils/httpError");

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = "7d";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function register({ name, email, password }) {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);

  if (existing.rows.length > 0) {
    throw new HttpError(409, "El correo ya está registrado");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [name, email, passwordHash]
  );

  const user = result.rows[0];
  const token = signToken(user);

  return { user, token };
}

async function login({ email, password }) {
  const result = await pool.query(
    "SELECT id, name, email, password_hash FROM users WHERE email = $1",
    [email]
  );

  const user = result.rows[0];

  if (!user) {
    throw new HttpError(401, "Credenciales inválidas");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    throw new HttpError(401, "Credenciales inválidas");
  }

  const token = signToken(user);

  return {
    user: { id: user.id, name: user.name, email: user.email },
    token,
  };
}

async function findUserById(id) {
  const result = await pool.query(
    "SELECT id, name, email, created_at FROM users WHERE id = $1",
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  register,
  login,
  findUserById,
};
