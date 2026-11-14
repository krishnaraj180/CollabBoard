const mongoose = require("mongoose");

const sprintSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    goal: { type: String, default: "", trim: true, maxlength: 1000 },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.startDate || value > this.startDate;
        },
        message: "Sprint end date must be after its start date",
      },
    },
    status: { type: String, enum: ["planned", "active", "completed"], default: "planned" },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

sprintSchema.index({ project: 1, status: 1 });
sprintSchema.index({ project: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

module.exports = mongoose.model("Sprint", sprintSchema);
