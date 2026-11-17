const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { clearAuthCookie, readToken, verifyToken } = require("../utils/tokens");

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) throw new AppError("Authentication required", 401);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    clearAuthCookie(res);
    throw new AppError("Invalid or expired session", 401);
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    clearAuthCookie(res);
    throw new AppError("User no longer exists", 401);
  }
  if ((payload.ver || 0) !== user.tokenVersion) {
    clearAuthCookie(res);
    throw new AppError("Session has ended", 401);
  }
  req.user = user;
  req.auth = payload;
  next();
});

module.exports = { requireAuth };
