const mongoose = require("mongoose");

const PRIORITIES = ["low", "medium", "high", "urgent"];

const checklistSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 4000 },
    columnId: { type: String, required: true, default: "todo" },
    order: { type: Number, default: 0 },
    assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    labels: [{ type: String, trim: true }],
    startDate: { type: Date },
    dueDate: { type: Date },
    priority: { type: String, enum: PRIORITIES, default: "medium" },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    sprint: { type: mongoose.Schema.Types.ObjectId, ref: "Sprint", default: null },
    dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    checklist: { type: [checklistSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    completedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", taskSchema);
module.exports.PRIORITIES = PRIORITIES;
