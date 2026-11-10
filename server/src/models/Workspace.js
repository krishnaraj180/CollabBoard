const mongoose = require("mongoose");
const { DEFAULT_DEPARTMENTS } = require("../utils/organization");
const { WORKSPACE_ROLES } = require("../utils/access");

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: WORKSPACE_ROLES, default: "member" },
    department: { type: String, default: "" },
    title: { type: String, default: "" },
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    positions: { type: [String], default: [] },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 400 },
    members: { type: [memberSchema], default: [] },
    organization: {
      version: { type: Number, default: 1 },
      departments: {
        type: [departmentSchema],
        default: () => DEFAULT_DEPARTMENTS.map((department) => ({
          name: department.name,
          positions: [...department.positions],
        })),
      },
    },
  },
  { timestamps: true }
);

workspaceSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Workspace", workspaceSchema);
