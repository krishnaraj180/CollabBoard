const Workspace = require("../models/Workspace");
const { AppError, asyncHandler } = require("../utils/errors");
const { memberOf } = require("../utils/access");
const { loadTenantResource, getMembership, enforcementMode } = require("../services/tenantAccess");

const resolveWorkspaceContext = asyncHandler(async (req, res, next) => {
  const id = req.params.id || req.params.workspaceId;
  const workspace = await loadTenantResource(Workspace, id, req.user, { route: req.originalUrl });
  const workspaceMembership = memberOf(workspace, req.user._id);
  const Organization = require("../models/Organization");
  const organization = workspace.organizationId ? await Organization.findById(workspace.organizationId).select("status") : null;
  const organizationMembership = organization ? await getMembership(req.user._id, organization._id) : null;
  if (!workspaceMembership && !organizationMembership && req.user.platformRole !== "super_admin") {
    if (enforcementMode() === "off") throw new AppError("You do not have access to this workspace", 403);
    throw new AppError("Resource not found", 404);
  }
  req.workspace = workspace;
  req.organization = organization;
  req.organizationMembership = organizationMembership;
  next();
});

module.exports = { resolveWorkspaceContext };
