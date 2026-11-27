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
const tenantEnforcement = (process.env.TENANT_ENFORCEMENT || "off").toLowerCase();
if (!["off", "log", "on"].includes(tenantEnforcement)) {
  throw new Error("TENANT_ENFORCEMENT must be off, log, or on");
}
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
  tenantEnforcement,
  tenantEnforcementOverride: process.env.TENANT_ENFORCEMENT_OVERRIDE === "true",
};

function validateStartupEnv() {
  const errors = [];
  if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) errors.push("PORT must be an integer between 1 and 65535");
  if (!env.clientOrigins.length) errors.push("CLIENT_ORIGIN must contain at least one origin");
  if (!env.mongoUri) errors.push("MONGODB_URI is required");
  if (!env.jwtSecret) errors.push("JWT_SECRET is required");
  if (env.isProd && env.jwtSecret.length < 32) errors.push("JWT_SECRET must be at least 32 characters in production");
  if (env.isProd && env.clientOrigins.some((origin) => !origin.startsWith("https://"))) errors.push("CLIENT_ORIGIN must use HTTPS in production");
  if (env.cookieSameSite === "none" && !env.isProd && env.clientOrigins.some((origin) => origin.startsWith("http://"))) errors.push("COOKIE_SAME_SITE=none with an HTTP client origin is unsafe");
  if (errors.length) throw new Error(`Environment validation failed:\n- ${errors.join("\n- ")}`);
}

module.exports = { env, validateStartupEnv };
