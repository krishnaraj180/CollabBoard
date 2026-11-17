const { AppError } = require("../utils/errors");
const { env } = require("../config/env");

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function validateOrigin(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (origin && !env.clientOrigins.includes(origin)) {
    return next(new AppError("Request origin is not allowed", 403));
  }
  return next();
}

module.exports = { validateOrigin };
