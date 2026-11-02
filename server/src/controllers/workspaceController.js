const { z } = require("zod");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember, requireRole, getMemberUserId } = require("../utils/access");
const Task = require("../models/Task");
const { notifyUsers } = require("../utils/notify");
const { logActivity } = require("../utils/activity");

const createSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80),
    description: z.string().max(400).optional().default(""),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(400).optional(),
  }),
});

const inviteSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member", "viewer"]).optional().default("member"),
  }),
});

const roleSchema = z.object({
  params: z.object({ id: z.string(), userId: z.string() }),
  body: z.object({ role: z.enum(["admin", "member", "viewer"]) }),
});

async function ensureGeneralChannel(workspace, userId) {
  const existing = await Channel.findOne({ workspace: workspace._id, type: "group", name: "general" });
  if (existing) return existing;
  return Channel.create({
    workspace: workspace._id,
    type: "group",
    name: "general",
    members: workspace.members.map((m) => m.user),
    createdBy: userId,
  });
}

const list = asyncHandler(async (req, res) => {
  const workspaces = await Workspace.find({ "members.user": req.user._id }).populate(
    "members.user",
    "name email avatarColor lastSeenAt"
  );
  res.json({ workspaces });
});

const create = asyncHandler(async (req, res) => {
  const workspace = await Workspace.create({
    name: req.body.name,
    description: req.body.description || "",
    members: [{ user: req.user._id, role: "owner" }],
  });
  await ensureGeneralChannel(workspace, req.user._id);
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.status(201).json({ workspace: populated });
});

const getOne = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id).populate(
    "members.user",
    "name email avatarColor lastSeenAt"
  );
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireMember(workspace, req.user._id);
  res.json({ workspace });
});

const invite = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireRole(workspace, req.user._id, ["owner", "admin"]);

  const invitee = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!invitee) throw new AppError("No account exists for that email", 404);
  if (workspace.members.some((m) => getMemberUserId(m) === String(invitee._id))) {
    throw new AppError("User is already a member", 409);
  }

  workspace.members.push({ user: invitee._id, role: req.body.role });
  await workspace.save();

  const general = await Channel.findOne({ workspace: workspace._id, name: "general", type: "group" });
  if (general && !general.members.some((id) => String(id) === String(invitee._id))) {
    general.members.push(invitee._id);
    await general.save();
  }

  await notifyUsers(req.app.get("io"), [invitee._id], {
    type: "workspace.invite",
    title: `Added to ${workspace.name}`,
    body: `${req.user.name} invited you as ${req.body.role}`,
    link: `/app/w/${workspace._id}`,
  });

  await logActivity(req.app.get("io"), {
    workspace: workspace._id,
    actor: req.user,
    action: "member.invited",
    summary: `added ${invitee.name} as ${req.body.role}`,
  });

  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const update = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireRole(workspace, req.user._id, ["owner", "admin"]);
  if (req.body.name !== undefined) workspace.name = req.body.name;
  if (req.body.description !== undefined) workspace.description = req.body.description;
  await workspace.save();
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const updateRole = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireRole(workspace, req.user._id, ["owner"]);
  const member = workspace.members.find((m) => getMemberUserId(m) === req.params.userId);
  if (!member) throw new AppError("Member not found", 404);
  if (member.role === "owner") throw new AppError("Cannot change the owner role", 400);
  member.role = req.body.role;
  await workspace.save();
  const changed = await User.findById(req.params.userId).select("name");
  await logActivity(req.app.get("io"), {
    workspace: workspace._id,
    actor: req.user,
    action: "member.role",
    summary: `changed ${changed?.name || "a member"} to ${req.body.role}`,
  });
  await notifyUsers(req.app.get("io"), [req.params.userId], {
    type: "workspace.role",
    title: `Your role in ${workspace.name} changed`,
    body: `${req.user.name} made you ${req.body.role}`,
    link: `/app/w/${workspace._id}`,
  });
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const removeMember = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const actor = requireMember(workspace, req.user._id);
  const targetId = req.params.userId;
  const target = workspace.members.find((m) => getMemberUserId(m) === targetId);
  if (!target) throw new AppError("Member not found", 404);
  if (target.role === "owner") throw new AppError("Cannot remove the owner", 400);
  const isSelf = String(req.user._id) === targetId;
  if (!isSelf && !["owner", "admin"].includes(actor.role)) {
    throw new AppError("Insufficient workspace permissions", 403);
  }
  if (actor.role === "admin" && target.role === "admin" && !isSelf) {
    throw new AppError("Admins cannot remove other admins", 403);
  }
  workspace.members = workspace.members.filter((m) => getMemberUserId(m) !== targetId);
  await workspace.save();
  await Channel.updateMany({ workspace: workspace._id }, { $pull: { members: targetId } });
  await Task.updateMany({ workspace: workspace._id }, { $pull: { assignees: targetId } });
  const removed = await User.findById(targetId).select("name");
  await logActivity(req.app.get("io"), {
    workspace: workspace._id,
    actor: req.user,
    action: "member.removed",
    summary: isSelf ? `${removed?.name || "A member"} left the workspace` : `removed ${removed?.name || "a member"}`,
  });
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

module.exports = {
  createSchema,
  updateSchema,
  inviteSchema,
  roleSchema,
  list,
  create,
  getOne,
  update,
  invite,
  updateRole,
  removeMember,
};
