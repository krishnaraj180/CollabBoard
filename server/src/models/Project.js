const mongoose = require("mongoose");

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"];

const columnSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    order: { type: Number, required: true },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 400 },
    columns: {
      type: [columnSchema],
      default: [
        { id: "todo", title: "To do", order: 0 },
        { id: "doing", title: "In progress", order: 1 },
        { id: "review", title: "Review", order: 2 },
        { id: "done", title: "Done", order: 3, done: true },
      ],
    },
    status: { type: String, enum: PROJECT_STATUSES, default: "active" },
    dueDate: { type: Date },
    completedAt: { type: Date },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
