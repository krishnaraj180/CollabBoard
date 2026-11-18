const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Organization = require("../models/Organization");
const { AppError, asyncHandler } = require("../utils/errors");
const { memberOf } = require("../utils/access");
const { organizationMemberOf } = require("../utils/organizationAccess");

const resolveWorkspaceContext = asyncHandler(async (req, res, next) => {
  const id = req.params.id || req.params.workspaceId;
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid workspace id", 400);
  const workspace = await Workspace.findById(id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const workspaceMembership = memberOf(workspace, req.user._id);
  const organization = workspace.organizationId ? await Organization.findById(workspace.organizationId).select("status members") : null;
    const organizationMembership = organization ? await organizationMemberOf(organization, req.user._id) : null;
  if (organization && req.user.platformRole !== "super_admin" && (!organizationMembership || organization.status !== "active")) {
    throw new AppError("You do not have access to this organization workspace", 403);
  }
  if (!workspaceMembership && !organizationMembership && req.user.platformRole !== "super_admin") {
    throw new AppError("You do not have access to this workspace", 403);
  }
  req.workspace = workspace;
  req.organization = organization;
  req.organizationMembership = organizationMembership;
  next();
});

module.exports = { resolveWorkspaceContext };
