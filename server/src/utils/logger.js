const crypto = require("crypto");

function safeId(value) {
  return value ? String(value._id || value) : null;
}

function log(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function requestLogger(req, res, next) {
  const requestId = req.get("x-request-id") || crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  req.id = requestId;
  res.set("X-Request-Id", requestId);
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    log(res.statusCode >= 500 ? "error" : "info", "http.request", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      organizationId: safeId(req.organization?._id || req.workspace?.organizationId || req.channel?.organizationId),
    });
  });
  next();
}

module.exports = { log, requestLogger };
