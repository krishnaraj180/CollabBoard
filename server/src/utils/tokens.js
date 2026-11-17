const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const COOKIE = "cb_token";
const SESSION_POLICIES = Object.freeze({
  STANDARD: "standard",
  REMEMBERED: "remembered",
  BROWSER: "browser",
});
const REMEMBERED_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function signToken(userId, tokenVersion = 0, sessionPolicy = SESSION_POLICIES.STANDARD) {
  const expiresIn = sessionPolicy === SESSION_POLICIES.REMEMBERED ? "30d" : env.jwtExpiresIn;
  return jwt.sign({ sub: String(userId), ver: tokenVersion, sessionPolicy }, env.jwtSecret, {
    expiresIn,
  });
}

function sessionCookieMaxAge(sessionPolicy = SESSION_POLICIES.STANDARD) {
  if (sessionPolicy === SESSION_POLICIES.REMEMBERED) return REMEMBERED_SESSION_MS;
  if (sessionPolicy === SESSION_POLICIES.BROWSER) return null;
  return env.sessionMaxAgeMs;
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

function cookieOptions(maxAge = env.sessionMaxAgeMs) {
  const options = {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.isProd || env.cookieSameSite === "none",
    path: "/",
  };
  if (maxAge !== null) options.maxAge = maxAge;
  return options;
}

function setAuthCookie(res, token, { maxAge = env.sessionMaxAgeMs } = {}) {
  res.cookie(COOKIE, token, cookieOptions(maxAge));
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: 0 });
}

function readToken(req) {
  return req.cookies?.[COOKIE];
}

module.exports = {
  COOKIE,
  SESSION_POLICIES,
  REMEMBERED_SESSION_MS,
  signToken,
  sessionCookieMaxAge,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  readToken,
};
