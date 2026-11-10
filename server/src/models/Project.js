const mongoose = require("mongoose");

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"];
const WORKFLOW_STAGES = [
  "business_approval",
  "technical_review",
  "project_setup",
  "team_assignment",
  "design",
  "development",
  "code_review",
  "qa_testing",
  "bug_fixing",
  "deployment",
  "production_release",
  "marketing_launch",
  "finance_review",
  "delivery_review",
  "executive_review",
  "completed",
];

const columnSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    order: { type: Number, required: true },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const workflowEntrySchema = new mongoose.Schema(
  {
    stage: { type: String, enum: WORKFLOW_STAGES, required: true },
    action: { type: String, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

const departmentAssignmentSchema = new mongoose.Schema(
  {
    department: { type: String, required: true, trim: true, maxlength: 60 },
    teamLead: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
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
    projectManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    scope: { type: String, default: "", maxlength: 4000 },
    budget: { type: Number, min: 0, default: null },
    milestones: { type: [String], default: [] },
    departmentAssignments: { type: [departmentAssignmentSchema], default: [] },
    workflowStage: { type: String, enum: WORKFLOW_STAGES, default: "business_approval" },
    workflowHistory: { type: [workflowEntrySchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
module.exports.WORKFLOW_STAGES = WORKFLOW_STAGES;
