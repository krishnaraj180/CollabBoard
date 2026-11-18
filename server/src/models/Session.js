const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sidHash: { type: String, required: true, unique: true, select: false },
    createdAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    userAgent: { type: String, default: "Unknown browser", maxlength: 300 },
    ipAddress: { type: String, default: "Unknown location", maxlength: 100 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { versionKey: false }
);

module.exports = mongoose.model("Session", sessionSchema);
