const mongoose = require("mongoose");

const securityEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true, enum: ["login", "logout", "password_changed", "email_change_requested", "email_verified", "session_revoked", "sessions_revoked"] },
    ipAddress: { type: String, default: "Unknown location", maxlength: 100 },
    userAgent: { type: String, default: "Unknown browser", maxlength: 300 },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("SecurityEvent", securityEventSchema);
