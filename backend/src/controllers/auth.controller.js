const authService = require("../services/auth.service");
const HttpError = require("../utils/httpError");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

function validateCredentials({ email, password }, { requireName, name } = {}) {
  if (requireName && (!name || !name.trim())) {
    throw new HttpError(400, "El nombre es obligatorio");
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    throw new HttpError(400, "El correo no es válido");
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
}

async function register(req, res) {
  const { name, email, password } = req.body;

  validateCredentials({ email, password }, { requireName: true, name });

  const { user, token } = await authService.register({ name: name.trim(), email, password });

  res.status(201).json({ user, token });
}

async function login(req, res) {
  const { email, password } = req.body;

  validateCredentials({ email, password });

  const { user, token } = await authService.login({ email, password });

  res.json({ user, token });
}

async function me(req, res) {
  const user = await authService.findUserById(req.user.id);

  if (!user) {
    throw new HttpError(404, "Usuario no encontrado");
  }

  res.json({ user });
}

module.exports = {
  register,
  login,
  me,
};
