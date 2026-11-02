const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "member", "viewer"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 400 },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true }
);

workspaceSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Workspace", workspaceSchema);
