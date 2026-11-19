const mongoose = require("mongoose");
const { ORGANIZATION_ROLES } = require("./Organization");

const MEMBERSHIP_STATUSES = ["active", "suspended", "revoked"];
const MEMBERSHIP_ROLES = [...new Set([...ORGANIZATION_ROLES, "organization_owner"])];

const organizationMembershipSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true, default: "active" },
    department: { type: String, default: "", trim: true, maxlength: 60 },
    title: { type: String, default: "", trim: true, maxlength: 60 },
    joinedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

organizationMembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
organizationMembershipSchema.index({ organizationId: 1, status: 1 });
organizationMembershipSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("OrganizationMembership", organizationMembershipSchema);
module.exports.MEMBERSHIP_STATUSES = MEMBERSHIP_STATUSES;
module.exports.MEMBERSHIP_ROLES = MEMBERSHIP_ROLES;
