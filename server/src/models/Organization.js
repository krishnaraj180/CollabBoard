const mongoose = require("mongoose");
const { DEFAULT_DEPARTMENTS } = require("../utils/organization");

const ORGANIZATION_ROLES = [
  "organization_admin",
  "business_management",
  "project_manager",
  "team_lead",
  "developer",
  "qa_tester",
  "viewer",
];

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ORGANIZATION_ROLES, default: "viewer" },
    department: { type: String, default: "", trim: true, maxlength: 60 },
    title: { type: String, default: "", trim: true, maxlength: 60 },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    positions: { type: [String], default: [] },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const locationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, required: true, trim: true, maxlength: 500 },
    contactName: { type: String, default: "", trim: true, maxlength: 80 },
    contactEmail: { type: String, default: "", trim: true, maxlength: 254 },
    contactPhone: { type: String, default: "", trim: true, maxlength: 40 },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: null },
  },
  { timestamps: true }
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    website: { type: String, default: "", trim: true, maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [memberSchema], default: [] },
    departments: {
      type: [departmentSchema],
      default: () => DEFAULT_DEPARTMENTS.map((department) => ({
        name: department.name,
        positions: [...department.positions],
      })),
    },
    locations: { type: [locationSchema], default: [] },
    settings: {
      defaultTaskCapacity: { type: Number, min: 1, max: 100, default: 10 },
    },
  },
  { timestamps: true }
);

organizationSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Organization", organizationSchema);
module.exports.ORGANIZATION_ROLES = ORGANIZATION_ROLES;
