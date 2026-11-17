const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const COOKIE = "cb_token";

function signToken(userId, tokenVersion = 0, expiresIn = env.jwtExpiresIn) {
  return jwt.sign({ sub: String(userId), ver: tokenVersion }, env.jwtSecret, {
    expiresIn,
  });
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
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  readToken,
};
