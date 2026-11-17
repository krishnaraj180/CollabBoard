const { z } = require("zod");
const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  readToken,
  verifyToken,
  SESSION_POLICIES,
  sessionCookieMaxAge,
} = require("../utils/tokens");
const { emitToUser } = require("../sockets");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../utils/mailer");

const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(72),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1).max(72),
    rememberMe: z.boolean().optional().default(true),
  }),
});

const profileSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80).optional(),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb").optional(),
  }),
});

const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(72),
  }),
});

const resetRequestSchema = z.object({ body: z.object({ email: z.string().email() }) });
const resetSchema = z.object({ body: z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(72) }) });

function palette(name) {
  const colors = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#059669", "#d97706"];
  let hash = 0;
  for (const ch of name) hash = (hash + ch.charCodeAt(0)) % colors.length;
  return colors[hash];
}

function notifySessionChange(req, res, userId) {
  const io = req.app.get("io");
  if (!io || !userId) return;
  res.once("finish", () => emitToUser(io, userId, "auth:session-changed"));
}

const register = asyncHandler(async (req, res) => {
  const { name, password } = req.body;
  const email = req.body.email.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) throw new AppError("Email already registered", 409);
  const passwordHash = await User.hashPassword(password);
  const user = await User.create({
    name,
    email,
    passwordHash,
    avatarColor: palette(name),
  });
  const token = signToken(user._id, user.tokenVersion);
  setAuthCookie(res, token);
  res.status(201).json({ user: user.toPublic() });
});

const login = asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const { password, rememberMe } = req.body;
  const user = await User.findOne({ email }).select("+passwordHash +loginFailures +lockedUntil");
  const locked = user?.lockedUntil && user.lockedUntil > new Date();
  if (!user || locked || !(await user.matchesPassword(password))) {
    if (user && !locked) {
      user.loginFailures += 1;
      if (user.loginFailures >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
    }
    throw new AppError("We couldn't sign you in with those details. Check your email and password and try again.", 401);
  }
  user.loginFailures = 0;
  user.lockedUntil = null;
  user.lastSeenAt = new Date();
  await user.save();
  const sessionPolicy = rememberMe ? SESSION_POLICIES.REMEMBERED : SESSION_POLICIES.BROWSER;
  const token = signToken(user._id, user.tokenVersion, sessionPolicy);
  setAuthCookie(res, token, { maxAge: sessionCookieMaxAge(sessionPolicy) });
  res.json({ user: user.toPublic() });
});

const logout = asyncHandler(async (req, res) => {
  const token = readToken(req);
  if (token) {
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      // An already-invalid token still needs its cookie cleared.
    }
    if (payload) {
      await User.findByIdAndUpdate(payload.sub, { $inc: { tokenVersion: 1 } });
      notifySessionChange(req, res, payload.sub);
    }
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toPublic() });
});

const updateMe = asyncHandler(async (req, res) => {
  if (req.body.name !== undefined) req.user.name = req.body.name;
  if (req.body.avatarColor !== undefined) req.user.avatarColor = req.body.avatarColor;
  await req.user.save();
  res.json({ user: req.user.toPublic() });
});

const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+passwordHash");
  if (!(await user.matchesPassword(req.body.currentPassword))) {
    throw new AppError("Current password is incorrect", 400);
  }
  if (req.body.currentPassword === req.body.newPassword) {
    throw new AppError("Choose a different password", 400);
  }
  user.passwordHash = await User.hashPassword(req.body.newPassword);
  // Ending every other session: old tokens carry the previous version number.
  user.tokenVersion += 1;
  await user.save();
  const sessionPolicy = Object.values(SESSION_POLICIES).includes(req.auth?.sessionPolicy)
    ? req.auth.sessionPolicy
    : SESSION_POLICIES.STANDARD;
  const token = signToken(user._id, user.tokenVersion, sessionPolicy);
  setAuthCookie(res, token, { maxAge: sessionCookieMaxAge(sessionPolicy) });
  notifySessionChange(req, res, user._id);
  res.json({ ok: true });
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email.trim().toLowerCase() }).select("+passwordResetTokenHash +passwordResetExpiresAt");
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    user.passwordResetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, token });
    } catch (error) {
      // Keep the response generic so mail configuration cannot reveal account existence.
      console.error("Password reset email failed:", error.message);
    }
  }
  res.json({ message: "If an account matches that email, we’ll send password reset instructions shortly." });
});

const resetPassword = asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
  const user = await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } }).select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt");
  if (!user) throw new AppError("This reset link is invalid or has expired. Request a new one and try again.", 400);
  user.passwordHash = await User.hashPassword(req.body.newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.loginFailures = 0;
  user.lockedUntil = null;
  user.tokenVersion += 1;
  await user.save();
  clearAuthCookie(res);
  notifySessionChange(req, res, user._id);
  res.json({ ok: true });
});

const revokeSessions = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
  clearAuthCookie(res);
  notifySessionChange(req, res, req.user._id);
  res.json({ ok: true });
});

module.exports = {
  registerSchema,
  loginSchema,
  profileSchema,
  passwordSchema,
  resetRequestSchema,
  resetSchema,
  register,
  login,
  logout,
  me,
  updateMe,
  changePassword,
  requestPasswordReset,
  resetPassword,
  revokeSessions,
};
