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
const { sendEmailVerificationEmail } = require("../utils/mailer");
const Session = require("../models/Session");
const SecurityEvent = require("../models/SecurityEvent");

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
    email: z.string().email().optional(),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb").optional(),
    avatarUrl: z.string().url().max(500).nullable().optional(),
  }),
});

const preferencesSchema = z.object({
  body: z.object({
    emailNotifications: z.boolean().optional(),
    inAppNotifications: z.boolean().optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    compactAccountDisplay: z.boolean().optional(),
  }).strict(),
});

const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(72),
  }),
});

const resetRequestSchema = z.object({ body: z.object({ email: z.string().email() }) });
const resetSchema = z.object({ body: z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(72) }) });
const emailVerificationSchema = z.object({ body: z.object({ token: z.string().min(20) }) });

function hashSessionId(id) { return crypto.createHash("sha256").update(id).digest("hex"); }
function recordSecurityEvent(req, userId, type) {
  return SecurityEvent.create({ user: userId, type, ipAddress: req.ip || "Unknown location", userAgent: req.get("user-agent") || "Unknown browser" }).catch((error) => console.error("Security event could not be recorded:", error.message));
}

async function issueSession(user, req, res, sessionPolicy) {
  const sid = crypto.randomUUID();
  const maxAge = sessionCookieMaxAge(sessionPolicy);
  const expiresAt = new Date(Date.now() + (maxAge || 7 * 24 * 60 * 60 * 1000));
  await Session.create({ user: user._id, sidHash: hashSessionId(sid), userAgent: req.get("user-agent") || "Unknown browser", ipAddress: req.ip || "Unknown location", expiresAt });
  const token = signToken(user._id, user.tokenVersion, sessionPolicy, sid);
  setAuthCookie(res, token, { maxAge });
}

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
  await issueSession(user, req, res, SESSION_POLICIES.STANDARD);
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
  await recordSecurityEvent(req, user._id, "login");
  const sessionPolicy = rememberMe ? SESSION_POLICIES.REMEMBERED : SESSION_POLICIES.BROWSER;
  await issueSession(user, req, res, sessionPolicy);
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
      if (payload.sid) await Session.deleteOne({ user: payload.sub, sidHash: hashSessionId(payload.sid) });
      await User.findByIdAndUpdate(payload.sub, { $inc: { tokenVersion: 1 } });
      await recordSecurityEvent(req, payload.sub, "logout");
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
  if (req.body.avatarUrl !== undefined) req.user.avatarUrl = req.body.avatarUrl;
  if (req.body.email !== undefined) {
    const email = req.body.email.trim().toLowerCase();
    if (email !== req.user.email) {
      if (await User.exists({ email, _id: { $ne: req.user._id } })) throw new AppError("Email already registered", 409);
      const token = crypto.randomBytes(32).toString("hex");
      req.user.pendingEmail = email;
      req.user.emailVerificationTokenHash = crypto.createHash("sha256").update(token).digest("hex");
      req.user.emailVerificationExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await req.user.save();
      await recordSecurityEvent(req, req.user._id, "email_change_requested");
      await sendEmailVerificationEmail({ to: email, name: req.user.name, token });
      return res.json({ user: req.user.toPublic(), message: "Check your new email address to finish verification." });
    }
  }
  await req.user.save();
  res.json({ user: req.user.toPublic() });
});

const updatePreferences = asyncHandler(async (req, res) => {
  Object.assign(req.user.preferences, req.body);
  await req.user.save();
  res.json({ preferences: req.user.preferences });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const hash = crypto.createHash("sha256").update(req.body.token).digest("hex");
  const user = await User.findOne({ emailVerificationTokenHash: hash, emailVerificationExpiresAt: { $gt: new Date() } }).select("+pendingEmail +emailVerificationTokenHash +emailVerificationExpiresAt");
  if (!user || !user.pendingEmail) throw new AppError("This verification link is invalid or has expired", 400);
  if (await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } })) throw new AppError("That email address is already registered", 409);
  user.email = user.pendingEmail;
  user.pendingEmail = null;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();
  await recordSecurityEvent(req, user._id, "email_verified");
  res.json({ user: user.toPublic() });
});

const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ user: req.user._id }).sort({ lastActivityAt: -1 }).lean();
  res.json({ sessions: sessions.map((session) => ({ ...session, id: String(session._id), current: session._id.equals(req.session?._id) })) });
});

const deleteSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.sessionId, user: req.user._id });
  if (!session) throw new AppError("Session not found", 404);
  if (req.session?._id.equals(session._id)) throw new AppError("Use sign out to end your current session", 400);
  await session.deleteOne();
  await recordSecurityEvent(req, req.user._id, "session_revoked");
  res.json({ ok: true });
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
  await Session.deleteMany({ user: user._id });
  await recordSecurityEvent(req, user._id, "password_changed");
  const sessionPolicy = Object.values(SESSION_POLICIES).includes(req.auth?.sessionPolicy)
    ? req.auth.sessionPolicy
    : SESSION_POLICIES.STANDARD;
  await issueSession(user, req, res, sessionPolicy);
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
  await Session.deleteMany({ user: user._id });
  await recordSecurityEvent(req, user._id, "password_changed");
  clearAuthCookie(res);
  notifySessionChange(req, res, user._id);
  res.json({ ok: true });
});

const revokeSessions = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
  await Session.deleteMany({ user: req.user._id });
  await recordSecurityEvent(req, req.user._id, "sessions_revoked");
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
  emailVerificationSchema,
  register,
  login,
  logout,
  me,
  updateMe,
  changePassword,
  requestPasswordReset,
  resetPassword,
  revokeSessions,
  preferencesSchema,
  updatePreferences,
  verifyEmail,
  listSessions,
  deleteSession,
};
