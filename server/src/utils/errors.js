const fs = require("fs");

class AppError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (!req.uploadsPersisted) {
    const uploadedPaths = new Set([
      ...(req.uploadedFilePaths || []),
      ...(req.files || []).map((file) => file.path).filter(Boolean),
    ]);
    for (const filePath of uploadedPaths) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          console.error("Failed to clean up uploaded file:", cleanupError.message);
        }
      }
    }
  }

  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "Invalid request",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({ error: `${field} already in use` });
  }

  const status = err.status || 500;
  const message = status >= 500 && envSafe() ? "Internal server error" : err.message;
  res.status(status).json({ error: message, details: err.details });
}

function envSafe() {
  return process.env.NODE_ENV === "production";
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { AppError, errorHandler, asyncHandler };
