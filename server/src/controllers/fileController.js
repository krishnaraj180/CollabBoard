const fs = require("fs");
const path = require("path");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Workspace = require("../models/Workspace");
const { dest } = require("../middleware/upload");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember } = require("../utils/access");

const ALLOWED = /^[\w.\-]+$/;

const serve = asyncHandler(async (req, res) => {
  const name = req.params.filename;
  if (!ALLOWED.test(name)) throw new AppError("Invalid filename", 400);
  const message = await Message.findOne({ "attachments.filename": name });
  if (!message) throw new AppError("File not found", 404);

  const [workspace, channel] = await Promise.all([
    Workspace.findById(message.workspace),
    Channel.findOne({ _id: message.channel, workspace: message.workspace }),
  ]);
  if (!workspace || !channel) throw new AppError("File not found", 404);
  requireMember(workspace, req.user._id);
  if (!channel.members.some((id) => String(id) === String(req.user._id))) {
    throw new AppError("You are not a member of this channel", 403);
  }

  const filePath = path.join(dest, name);
  if (!filePath.startsWith(dest)) throw new AppError("Invalid filename", 400);
  if (!fs.existsSync(filePath)) throw new AppError("File not found", 404);
  res.sendFile(filePath);
});

module.exports = { serve };
