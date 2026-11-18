const { asyncHandler } = require("../utils/errors");
const { loadTenantResource, getMembership } = require("../services/tenantAccess");
const { organizationSuspended, tenantNotFound } = require("../utils/tenantErrors");

const resolveOrganizationContext = asyncHandler(async (req, res, next) => {
  const id = req.params.id || req.params.organizationId;
  const Organization = require("../models/Organization");
  const organization = await loadTenantResource(Organization, id, req.user, { route: req.originalUrl });
  const membership = await getMembership(req.user._id, organization._id);
  if (organization.status === "suspended" && membership) throw organizationSuspended();
  if (!membership && req.user.platformRole !== "super_admin") throw tenantNotFound();
  req.organization = organization;
  req.organizationMembership = membership;
  next();
});

module.exports = { resolveOrganizationContext };
