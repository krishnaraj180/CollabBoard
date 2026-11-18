const OrganizationMembership = require("../models/OrganizationMembership");

async function findMembership(organizationId, userId) {
  return OrganizationMembership.findOne({ organizationId, userId });
}

async function findActiveMembership(organizationId, userId) {
  return OrganizationMembership.findOne({ organizationId, userId, status: "active" }).lean();
}

async function createMembership({ organizationId, userId, role, status = "active", department = "", title = "" }) {
  return OrganizationMembership.create({ organizationId, userId, role, status, department, title });
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
};
