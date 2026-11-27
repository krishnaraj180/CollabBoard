const fs = require("fs");
const path = require("path");
const Message = require("../models/Message");
const { dest } = require("../middleware/upload");
const { AppError, asyncHandler } = require("../utils/errors");
const { memberOf } = require("../utils/access");
const { listScope } = require("../services/tenantAccess");

const ALLOWED = /^[\w.\-]+$/;

async function findTenantMessageForFile(name, userId) {
  if (userId?.platformRole === "super_admin") {
    return Message.findOne({ "attachments.filename": name }).populate({ path: "channel", populate: { path: "workspace" } });
  }
  const scope = await listScope(userId?._id || userId);
  return Message.findOne({
    "attachments.filename": name,
    $or: [
      { organizationId: { $in: scope.organizationIds } },
      { organizationId: null, workspace: { $in: scope.legacyWorkspaceIds } },
    ],
  }).populate({ path: "channel", populate: { path: "workspace" } });
}

const serve = asyncHandler(async (req, res) => {
  const name = req.params.filename;
  const notFound = () => new AppError("File not found", 404);
  if (!ALLOWED.test(name)) throw notFound();
  const message = await findTenantMessageForFile(name, req.user);
  if (!message) throw new AppError("File not found", 404);

  const channel = message.channel;
  const workspace = channel?.workspace;
  if (!workspace || String(message.workspace) !== String(workspace._id) || String(channel.workspace?._id || channel.workspace) !== String(workspace._id)) throw notFound();
  const isSuperAdmin = req.user.platformRole === "super_admin";
  if (!isSuperAdmin && (!memberOf(workspace, req.user._id) || !channel.members.some((id) => String(id) === String(req.user._id)))) throw notFound();
  if (isSuperAdmin) {
    console.warn(JSON.stringify({ event: "super_admin.file_access", userId: String(req.user._id), organizationId: workspace.organizationId ? String(workspace.organizationId) : null, workspaceId: String(workspace._id), channelId: String(channel._id), filename: name, timestamp: new Date().toISOString() }));
  }

  const filePath = path.join(dest, name);
  if (!filePath.startsWith(dest)) throw notFound();
  if (!fs.existsSync(filePath)) throw notFound();
  res.sendFile(filePath);
});

module.exports = { serve, findTenantMessageForFile };
