const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { readToken, verifyToken } = require("../utils/tokens");

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = readToken(req);
  if (!token) throw new AppError("Authentication required", 401);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AppError("Invalid or expired session", 401);
  }

  const user = await User.findById(payload.sub);
  if (!user) throw new AppError("User no longer exists", 401);
  if ((payload.ver || 0) !== user.tokenVersion) {
    throw new AppError("Session has ended", 401);
  }
  req.user = user;
  next();
});

module.exports = { requireAuth };
