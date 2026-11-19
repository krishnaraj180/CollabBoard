const Channel = require("../models/Channel");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember } = require("../utils/access");
const { loadTenantResource } = require("../services/tenantAccess");

const authorizeChannelMessage = asyncHandler(async (req, res, next) => {
  const { channelId } = req.params;
  const channel = await loadTenantResource(Channel, channelId, req.user, { populate: "workspace", route: req.originalUrl });
  const workspace = channel.workspace;

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
