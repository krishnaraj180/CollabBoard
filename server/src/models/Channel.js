const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    type: { type: String, enum: ["group", "dm"], default: "group" },
    name: { type: String, trim: true, maxlength: 80 },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

channelSchema.index({ workspace: 1, type: 1, name: 1 });

module.exports = mongoose.model("Channel", channelSchema);
