const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const COOKIE = "cb_token";

function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), ver: tokenVersion }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: env.sessionMaxAgeMs,
    path: "/",
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: 0 });
}

function readToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[COOKIE];
}

module.exports = {
  COOKIE,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  readToken,
};
