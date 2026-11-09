const { z } = require("zod");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember, getMemberUserId } = require("../utils/access");
const { emitToChannel, emitToWorkspace } = require("../sockets");
const { notifyUsers } = require("../utils/notify");

const channelSchema = z.object({
  params: z.object({ workspaceId: z.string() }),
  body: z.object({
    name: z.string().min(2).max(80),
    memberIds: z.array(z.string()).optional().default([]),
  }),
});

async function loadWorkspace(id, userId) {
  const workspace = await Workspace.findById(id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const membership = requireMember(workspace, userId);
  return { workspace, membership };
}

function requireWritableMember(membership) {
  if (membership.role === "viewer") {
    throw new AppError("Viewers have read-only access", 403);
  }
}

function assertChannelMember(channel, userId) {
  if (!channel.members.some((id) => String(id) === String(userId))) {
    throw new AppError("You are not a member of this channel", 403);
  }
}

const listChannels = asyncHandler(async (req, res) => {
  await loadWorkspace(req.params.workspaceId, req.user._id);
  const channels = await Channel.find({
    workspace: req.params.workspaceId,
    members: req.user._id,
  })
    .populate("members", "name email avatarColor")
    .sort({ type: 1, name: 1 });
  res.json({ channels });
});

const createChannel = asyncHandler(async (req, res) => {
  const { workspace, membership } = await loadWorkspace(req.params.workspaceId, req.user._id);
  requireWritableMember(membership);
  const memberIds = new Set([String(req.user._id), ...(req.body.memberIds || [])]);
  const workspaceIds = new Set(workspace.members.map((m) => getMemberUserId(m)));
  for (const id of memberIds) {
    if (!workspaceIds.has(id)) throw new AppError("Channel members must belong to the workspace", 400);
  }
  const channel = await Channel.create({
    workspace: workspace._id,
    type: "group",
    name: req.body.name,
    members: [...memberIds],
    createdBy: req.user._id,
  });
  await channel.populate("members", "name email avatarColor");
  emitToWorkspace(req.app.get("io"), workspace._id, "channel:created", { channel });
  res.status(201).json({ channel });
});

const listMessages = asyncHandler(async (req, res) => {
  const channel = await Channel.findById(req.params.channelId);
  if (!channel) throw new AppError("Channel not found", 404);
  await loadWorkspace(channel.workspace, req.user._id);
  assertChannelMember(channel, req.user._id);
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const before = req.query.before;
  const filter = { channel: channel._id };
  if (before) filter.createdAt = { $lt: new Date(before) };
  const messages = await Message.find(filter)
    .populate("sender", "name email avatarColor")
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json({ messages: messages.reverse() });
});

const createMessage = asyncHandler(async (req, res) => {
  const channel = await Channel.findById(req.params.channelId);
  if (!channel) throw new AppError("Channel not found", 404);
  const { membership } = await loadWorkspace(channel.workspace, req.user._id);
  requireWritableMember(membership);
  assertChannelMember(channel, req.user._id);

  const body = (req.body.body || "").trim();
  const attachments = (req.files || []).map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url: `/api/files/${file.filename}`,
  }));
  if (!body && attachments.length === 0) {
    throw new AppError("Message cannot be empty", 400);
  }

  const message = await Message.create({
    workspace: channel.workspace,
    channel: channel._id,
    sender: req.user._id,
    body,
    attachments,
  });
  req.uploadsPersisted = true;
  await message.populate("sender", "name email avatarColor");

  const payload = { message };
  emitToChannel(req.app.get("io"), channel._id, "chat:message", payload);

  const others = channel.members.filter((id) => String(id) !== String(req.user._id));
  await notifyUsers(req.app.get("io"), others, {
    type: "chat.message",
    title: channel.name || "Direct message",
    body: `${req.user.name}: ${body || "sent a file"}`,
    link: `/app/w/${channel.workspace}/chat/${channel._id}`,
    meta: { channelId: String(channel._id) },
  });

  res.status(201).json({ message });
});

module.exports = {
  channelSchema,
  listChannels,
  createChannel,
  listMessages,
  createMessage,
};
