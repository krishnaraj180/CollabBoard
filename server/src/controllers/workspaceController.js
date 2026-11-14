const { z } = require("zod");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember, requireRole, getMemberUserId } = require("../utils/access");
const Task = require("../models/Task");
const Project = require("../models/Project");
const { notifyUsers } = require("../utils/notify");
const { logActivity } = require("../utils/activity");
const { DEFAULT_DEPARTMENTS } = require("../utils/organization");
const { ASSIGNABLE_WORKSPACE_ROLES } = require("../utils/access");

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
    role: z.enum(ASSIGNABLE_WORKSPACE_ROLES).optional().default("member"),
  }),
});

const roleSchema = z.object({
  params: z.object({ id: z.string(), userId: z.string() }),
  body: z.object({ role: z.enum(ASSIGNABLE_WORKSPACE_ROLES) }),
});

const organizationMemberSchema = z.object({
  params: z.object({ id: z.string(), userId: z.string() }),
  body: z.object({
    department: z.string().max(60).default(""),
    title: z.string().max(60).default(""),
    reportsTo: z.string().nullable().optional().default(null),
  }).refine(
    ({ department, title }) => (!department && !title) || (department && title),
    { message: "Choose both a department and a position, or clear both" }
  ),
});

const organizationSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    departments: z.array(z.object({
      name: z.string().trim().min(1).max(60),
      positions: z.array(z.string().trim().min(1).max(60)).max(30),
    })).min(1).max(20),
  }).refine(({ departments }) => {
    const names = departments.map(({ name }) => name.toLowerCase());
    return new Set(names).size === names.length &&
      departments.every(({ positions }) => new Set(positions.map((position) => position.toLowerCase())).size === positions.length);
  }, { message: "Department and position names must be unique" }),
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

async function validateLeadershipAssignment(workspace, userId, role, currentMemberId = null) {
  const otherDirectorLocation = await Workspace.findOne({
    _id: { $ne: workspace._id },
    members: { $elemMatch: { user: userId, role: "managing_director" } },
  }).select("name");

  if (role === "managing_director") {
    const anotherDirector = workspace.members.find((member) =>
      member.role === "managing_director" &&
      getMemberUserId(member) !== String(currentMemberId || userId)
    );
    if (anotherDirector) {
      throw new AppError("This location already has a Managing Director", 409);
    }

    const otherLocation = await Workspace.findOne({
      _id: { $ne: workspace._id },
      members: { $elemMatch: { user: userId } },
    }).select("name");
    if (otherLocation) {
      throw new AppError(`A Managing Director can only belong to one location; this user is already in ${otherLocation.name}`, 409);
    }
  } else if (otherDirectorLocation) {
    throw new AppError(`This user is the Managing Director in ${otherDirectorLocation.name} and cannot belong to another location`, 409);
  }

  if (role === "ceo") {
    const otherCeo = await Workspace.findOne({
      members: { $elemMatch: { user: { $ne: userId }, role: "ceo" } },
    }).select("_id");
    if (otherCeo) {
      throw new AppError("A different CEO is already assigned to the company", 409);
    }
  }
}

const create = asyncHandler(async (req, res) => {
  const workspace = await Workspace.create({
    name: req.body.name,
    description: req.body.description || "",
    members: [{ user: req.user._id, role: "owner" }],
    organization: { version: 3, departments: DEFAULT_DEPARTMENTS },
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
  if ((workspace.organization?.version || 1) < 3) {
    const existingDepartments = new Map(
      (workspace.organization?.departments || []).map((department) => [department.name, department])
    );
    const defaultDepartments = DEFAULT_DEPARTMENTS.map((department) => {
      const existing = existingDepartments.get(department.name);
      existingDepartments.delete(department.name);
      return {
        name: department.name,
        positions: [...new Set([...(existing?.positions || []), ...department.positions])],
      };
    });
    const mergedDepartments = [...defaultDepartments, ...existingDepartments.values()].map((department) => ({
      name: department.name,
      positions: [...department.positions],
    }));
    workspace.organization.departments = mergedDepartments;
    workspace.organization.version = 3;
    await workspace.save();
  }
  res.json({ workspace });
});

const invite = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const actor = requireRole(workspace, req.user._id, ["owner", "admin", "ceo", "managing_director"]);
  if (actor.role === "managing_director" && ["admin", "ceo", "managing_director"].includes(req.body.role)) {
    throw new AppError("Managing directors cannot invite workspace leadership", 403);
  }
  if (actor.role === "admin" && ["ceo", "managing_director"].includes(req.body.role)) {
    throw new AppError("Only the CEO or workspace owner can assign company leadership", 403);
  }

  const invitee = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!invitee) throw new AppError("No account exists for that email", 404);
  if (workspace.members.some((m) => getMemberUserId(m) === String(invitee._id))) {
    throw new AppError("User is already a member", 409);
  }
  await validateLeadershipAssignment(workspace, invitee._id, req.body.role);

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
  requireRole(workspace, req.user._id, ["owner", "admin", "ceo"]);
  if (req.body.name !== undefined) workspace.name = req.body.name;
  if (req.body.description !== undefined) workspace.description = req.body.description;
  await workspace.save();
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const updateRole = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const actor = requireRole(workspace, req.user._id, ["owner", "ceo"]);
  const member = workspace.members.find((m) => getMemberUserId(m) === req.params.userId);
  if (!member) throw new AppError("Member not found", 404);
  if (member.role === "owner") throw new AppError("Cannot change the owner role", 400);
  if (actor.role === "ceo" && String(req.user._id) === req.params.userId && req.body.role !== "ceo") {
    throw new AppError("The CEO cannot remove their own company role", 403);
  }
  await validateLeadershipAssignment(workspace, member.user, req.body.role, req.params.userId);
  const wasProjectManager = member.role === "project_manager";
  member.role = req.body.role;
  await workspace.save();
  if (wasProjectManager && member.role !== "project_manager") {
    await Project.updateMany(
      { workspace: workspace._id, projectManager: req.params.userId },
      { $set: { projectManager: null } }
    );
  }
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

const updateOrganizationMember = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireRole(workspace, req.user._id, ["owner", "admin", "ceo", "managing_director"]);
  const member = workspace.members.find((m) => getMemberUserId(m) === req.params.userId);
  if (!member) throw new AppError("Member not found", 404);

  const { department, title, reportsTo } = req.body;
  if (department && !workspace.organization.departments.some((item) => item.name === department && item.positions.includes(title))) {
    throw new AppError("Choose a position from the selected department", 400);
  }
  if (reportsTo) {
    if (reportsTo === req.params.userId || !workspace.members.some((item) => getMemberUserId(item) === reportsTo)) {
      throw new AppError("Choose another member of this workspace as the manager", 400);
    }

    let manager = workspace.members.find((item) => getMemberUserId(item) === reportsTo);
    const visited = new Set([req.params.userId]);
    while (manager?.reportsTo) {
      const managerId = getMemberUserId(manager);
      if (visited.has(managerId)) {
        throw new AppError("Reporting lines cannot contain a cycle", 400);
      }
      visited.add(managerId);
      manager = workspace.members.find((item) => getMemberUserId(item) === String(manager.reportsTo));
    }
    if (manager && visited.has(getMemberUserId(manager))) {
      throw new AppError("Reporting lines cannot contain a cycle", 400);
    }
  }

  member.department = department;
  member.title = title;
  member.reportsTo = reportsTo || null;
  await workspace.save();
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const updateOrganization = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  requireRole(workspace, req.user._id, ["owner", "admin", "ceo", "managing_director"]);

  workspace.organization.departments = req.body.departments;
  workspace.organization.version = 2;
  const departments = new Map(req.body.departments.map((item) => [item.name, new Set(item.positions)]));
  for (const member of workspace.members) {
    if (member.department && !departments.get(member.department)?.has(member.title)) {
      member.department = "";
      member.title = "";
    }
  }
  await workspace.save();
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

const removeMember = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const actor = requireRole(workspace, req.user._id, ["owner", "admin", "ceo", "managing_director"]);
  const targetId = req.params.userId;
  const target = workspace.members.find((m) => getMemberUserId(m) === targetId);
  if (!target) throw new AppError("Member not found", 404);
  if (target.role === "owner") throw new AppError("Cannot remove the owner", 400);
  const isSelf = String(req.user._id) === targetId;
  if (isSelf) throw new AppError("You cannot remove yourself from the workspace", 403);
  if (actor.role === "admin" && target.role === "admin") {
    throw new AppError("Admins cannot remove other admins", 403);
  }
  if (actor.role === "managing_director" && ["admin", "ceo", "managing_director"].includes(target.role)) {
    throw new AppError("Managing directors cannot remove workspace leadership", 403);
  }
  workspace.members = workspace.members
    .filter((m) => getMemberUserId(m) !== targetId)
    .map((m) => {
      if (String(m.reportsTo) === targetId) m.reportsTo = null;
      return m;
    });
  await workspace.save();
  if (target.role === "project_manager") {
    await Project.updateMany(
      { workspace: workspace._id, projectManager: targetId },
      { $set: { projectManager: null } }
    );
  }
  await Channel.updateMany({ workspace: workspace._id }, { $pull: { members: targetId } });
  await Task.updateMany({ workspace: workspace._id }, { $pull: { assignees: targetId } });
  const removed = await User.findById(targetId).select("name");
  await logActivity(req.app.get("io"), {
    workspace: workspace._id,
    actor: req.user,
    action: "member.removed",
    summary: `removed ${removed?.name || "a member"}`,
  });
  const populated = await workspace.populate("members.user", "name email avatarColor lastSeenAt");
  res.json({ workspace: populated });
});

module.exports = {
  createSchema,
  updateSchema,
  inviteSchema,
  roleSchema,
  organizationMemberSchema,
  organizationSchema,
  list,
  create,
  getOne,
  update,
  invite,
  updateRole,
  updateOrganizationMember,
  updateOrganization,
  removeMember,
};
