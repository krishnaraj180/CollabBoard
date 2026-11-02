const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    summary: { type: String, required: true, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activitySchema.index({ workspace: 1, createdAt: -1 });

module.exports = mongoose.model("Activity", activitySchema);
