const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isTest = process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";
const cookieSameSite = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
if (!["lax", "strict", "none"].includes(cookieSameSite)) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
}
if (isProd && (process.env.JWT_SECRET || "").length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  // Comma-separated list so a staging and production frontend can share one API.
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  clientOrigin: (process.env.CLIENT_ORIGIN || "http://localhost:3000").split(",")[0].trim(),
  mongoUri: isTest ? process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/collabboard-test" : required("MONGODB_URI"),
  jwtSecret: isTest ? process.env.JWT_SECRET || "test-secret-do-not-use" : required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_DAYS || 7) * 24 * 60 * 60 * 1000,
  cookieSameSite,
  passwordResetUrl: process.env.PASSWORD_RESET_URL || "http://localhost:3000/reset-password",
  mailFrom: process.env.MAIL_FROM || "CollabBoard <no-reply@example.com>",
  resendApiKey: process.env.RESEND_API_KEY || "",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxFileMb: Number(process.env.MAX_FILE_MB || 10),
  isProd,
  isTest,
};

module.exports = { env };
