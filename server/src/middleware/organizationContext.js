const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const { AppError, asyncHandler } = require("../utils/errors");
const { organizationMemberOf } = require("../utils/organizationAccess");

const resolveOrganizationContext = asyncHandler(async (req, res, next) => {
  const id = req.params.id || req.params.organizationId;
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid organization id", 400);
  const organization = await Organization.findById(id);
  if (!organization) throw new AppError("Organization not found", 404);
  if (organization.status !== "active" && req.user.platformRole !== "super_admin") {
    throw new AppError("Organization is not active", 403);
  }
  const membership = await organizationMemberOf(organization, req.user._id);
  if (!membership && req.user.platformRole !== "super_admin") {
    throw new AppError("You do not have access to this organization", 404);
  }
  req.organization = organization;
  req.organizationMembership = membership;
  next();
});

module.exports = { resolveOrganizationContext };
