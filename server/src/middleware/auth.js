const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { clearAuthCookie, readToken, verifyToken } = require("../utils/tokens");
const Session = require("../models/Session");

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
  if (payload.sid) {
    const session = await Session.findOne({ user: user._id, sidHash: require("crypto").createHash("sha256").update(payload.sid).digest("hex") }).select("+sidHash");
    if (!session) {
      clearAuthCookie(res);
      throw new AppError("Session has ended", 401);
    }
    session.lastActivityAt = new Date();
    await session.save();
    req.session = session;
  }
  req.user = user;
  req.auth = payload;
  next();
});

module.exports = { requireAuth };
