const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    avatarColor: { type: String, default: "#2563eb" },
    avatarUrl: { type: String, default: null, trim: true, maxlength: 500 },
    pendingEmail: { type: String, default: null, lowercase: true, trim: true, select: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },
    preferences: {
      emailNotifications: { type: Boolean, default: true },
      inAppNotifications: { type: Boolean, default: true },
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      compactAccountDisplay: { type: Boolean, default: false },
    },
    platformRole: { type: String, enum: ["super_admin"], default: null },
    lastSeenAt: { type: Date, default: Date.now },
    tokenVersion: { type: Number, default: 0 },
    loginFailures: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.methods.matchesPassword = function matchesPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    _id: this._id,
    name: this.name,
    email: this.email,
    avatarColor: this.avatarColor,
    avatarUrl: this.avatarUrl,
    platformRole: this.platformRole,
    lastSeenAt: this.lastSeenAt,
    emailVerified: !this.pendingEmail,
    preferences: this.preferences,
  };
};

module.exports = mongoose.model("User", userSchema);
