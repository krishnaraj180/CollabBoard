const OrganizationMembership = require("../models/OrganizationMembership");
const { resolveRoleForMembership, legacyRoleForRole } = require("../services/roleService");

async function findMembership(organizationId, userId) {
  return OrganizationMembership.findOne({ organizationId, userId });
}

async function findActiveMembership(organizationId, userId) {
  return OrganizationMembership.findOne({ organizationId, userId, status: "active" }).lean();
}

async function createMembership({ organizationId, userId, role, status = "active", department = "", title = "" }) {
  const systemRole = await resolveRoleForMembership(organizationId, role);
  return OrganizationMembership.create({ organizationId, userId, role, roleId: systemRole?._id || null, status, department, title });
}

async function syncMembershipRole(membership, nextRole) {
  const systemRole = await resolveRoleForMembership(membership.organizationId, nextRole);
  membership.role = nextRole;
  membership.roleId = systemRole?._id || null;
  return membership;
}

async function syncMembershipToRole(membership, role) {
  membership.role = legacyRoleForRole(role);
  membership.roleId = role._id;
  return membership;
}

async function countActiveOwners(organizationId, excludedUserId = null) {
  const query = { organizationId, role: "organization_owner", status: "active" };
  if (excludedUserId) query.userId = { $ne: excludedUserId };
  return OrganizationMembership.countDocuments(query);
}

async function assertOwnerInvariant(organizationId, membership, nextRole, nextStatus = membership.status) {
  const remainsOwner = membership.role === "organization_owner" && nextRole !== "organization_owner";
  const remainsActive = nextStatus === "active";
  if (remainsOwner && remainsActive && await countActiveOwners(organizationId, membership.userId) === 0) {
    const error = new Error("An organization must retain at least one active owner");
    error.status = 409;
    throw error;
  }
  if (membership.role === "organization_owner" && !remainsActive &&
      await countActiveOwners(organizationId, membership.userId) === 0) {
    const error = new Error("An organization must retain at least one active owner");
    error.status = 409;
    throw error;
  }
}

module.exports = {
  findMembership,
  findActiveMembership,
  createMembership,
  countActiveOwners,
  assertOwnerInvariant,
  syncMembershipRole,
  syncMembershipToRole,
};
