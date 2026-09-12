const jwt = require("jsonwebtoken");
const HttpError = require("../utils/httpError");

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "Token no proporcionado"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    next(new HttpError(401, "Token inválido o expirado"));
  }
}

module.exports = authMiddleware;
