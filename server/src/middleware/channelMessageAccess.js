const mongoose = require("mongoose");
const Channel = require("../models/Channel");
const Workspace = require("../models/Workspace");
const Organization = require("../models/Organization");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember } = require("../utils/access");
const { organizationMemberOf } = require("../utils/organizationAccess");

const authorizeChannelMessage = asyncHandler(async (req, res, next) => {
  const { channelId } = req.params;
  if (!mongoose.isValidObjectId(channelId)) throw new AppError("Invalid channel id", 400);

  const channel = await Channel.findById(channelId);
  if (!channel) throw new AppError("Channel not found", 404);
  const workspace = await Workspace.findById(channel.workspace);
  if (!workspace) throw new AppError("Workspace not found", 404);
  if (workspace.organizationId) {
    const organization = await Organization.findById(workspace.organizationId).select("status members");
    if (!organization || organization.status !== "active" || !await organizationMemberOf(organization, req.user._id)) {
      throw new AppError("You do not have access to this organization workspace", 403);
    }
  }

  const membership = requireMember(workspace, req.user._id);
  if (membership.role === "viewer") {
    throw new AppError("Viewers have read-only access", 403);
  }
  if (!channel.members.some((id) => String(id) === String(req.user._id))) {
    throw new AppError("You are not a member of this channel", 403);
  }

  next();
});

module.exports = { authorizeChannelMessage };
