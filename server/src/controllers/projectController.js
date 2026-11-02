const { z } = require("zod");
const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Activity = require("../models/Activity");
const { PROJECT_STATUSES } = Project;
const { PRIORITIES } = Task;
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember, isManager, getMemberUserId } = require("../utils/access");
const { emitToWorkspace } = require("../sockets");
const { notifyUsers } = require("../utils/notify");
const { logActivity } = require("../utils/activity");

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const dateField = z.union([z.string(), z.null()]).optional();
const checklistField = z
  .array(
    z.object({
      _id: z.string().optional(),
      text: z.string().min(1).max(200),
      done: z.boolean().optional().default(false),
    })
  )
  .max(50);

const createSchema = z.object({
  params: z.object({ workspaceId: z.string() }),
  body: z.object({
    name: z.string().min(2).max(80),
    description: z.string().max(400).optional().default(""),
    status: z.enum(PROJECT_STATUSES).optional(),
    dueDate: dateField,
  }),
});

const projectUpdateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(400).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    dueDate: dateField,
  }),
});

const taskCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    title: z.string().min(1).max(160),
    description: z.string().max(4000).optional().default(""),
    columnId: z.string().optional(),
    assignees: z.array(z.string()).optional().default([]),
    labels: z.array(z.string().max(24)).optional().default([]),
    priority: z.enum(PRIORITIES).optional(),
    checklist: checklistField.optional(),
    dueDate: dateField,
  }),
});

const taskUpdateSchema = z.object({
  params: z.object({ id: z.string(), taskId: z.string() }),
  body: z.object({
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(4000).optional(),
    columnId: z.string().optional(),
    order: z.number().optional(),
    assignees: z.array(z.string()).optional(),
    labels: z.array(z.string().max(24)).optional(),
    priority: z.enum(PRIORITIES).optional(),
    checklist: checklistField.optional(),
    dueDate: dateField,
  }),
});

const commentSchema = z.object({
  params: z.object({ id: z.string(), taskId: z.string() }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const USER_FIELDS = "name email avatarColor";

function assertObjectId(id, label = "id") {
  if (!mongoose.isValidObjectId(id)) throw new AppError(`Invalid ${label}`, 400);
}

/** Column ids that count as "finished". Falls back for boards created before the `done` flag. */
function doneColumnIds(project) {
  const flagged = project.columns.filter((c) => c.done).map((c) => c.id);
  if (flagged.length) return flagged;
  const byId = project.columns.find((c) => c.id === "done");
  if (byId) return [byId.id];
  const last = [...project.columns].sort((a, b) => a.order - b.order).pop();
  return last ? [last.id] : [];
}

function parseDate(value) {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError("Invalid date", 400);
  return d;
}

async function loadWorkspace(id, userId) {
  assertObjectId(id, "workspace id");
  const workspace = await Workspace.findById(id);
  if (!workspace) throw new AppError("Workspace not found", 404);
  const membership = requireMember(workspace, userId);
  return { workspace, membership };
}

/** Loads project + workspace and the caller's membership in one go. */
async function loadProject(req) {
  assertObjectId(req.params.id, "project id");
  const project = await Project.findById(req.params.id);
  if (!project) throw new AppError("Project not found", 404);
  const { workspace, membership } = await loadWorkspace(project.workspace, req.user._id);
  return { project, workspace, membership };
}

function requireManager(membership) {
  if (!isManager(membership.role)) {
    throw new AppError("Only workspace owners and admins can do this", 403);
  }
}

function assertAssigneesInWorkspace(workspace, ids) {
  const allowed = new Set(workspace.members.map((m) => getMemberUserId(m)));
  for (const id of ids) {
    if (!allowed.has(String(id))) throw new AppError("Assignees must belong to the workspace", 400);
  }
}

async function populateTask(task) {
  await task.populate([
    { path: "assignees", select: USER_FIELDS },
    { path: "createdBy", select: "name" },
    { path: "comments.author", select: "name avatarColor" },
  ]);
  return task;
}

/** Summarise a set of tasks for a project: counts, percent complete, overdue. */
function computeStats(project, tasks) {
  const done = new Set(doneColumnIds(project));
  const now = Date.now();
  const byColumn = {};
  project.columns.forEach((c) => (byColumn[c.id] = 0));
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  for (const t of tasks) {
    byColumn[t.columnId] = (byColumn[t.columnId] || 0) + 1;
    const isDone = done.has(t.columnId);
    if (isDone) completed += 1;
    if (!isDone && t.dueDate) {
      const due = new Date(t.dueDate).getTime();
      if (due < now) overdue += 1;
      else if (due - now < 3 * 24 * 3600 * 1000) dueSoon += 1;
    }
  }
  const total = tasks.length;
  return {
    total,
    completed,
    open: total - completed,
    overdue,
    dueSoon,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    byColumn,
  };
}

function projectOverdue(project) {
  return Boolean(project.dueDate && project.status !== "completed" && new Date(project.dueDate) < new Date());
}

async function statsForProjects(projects) {
  const ids = projects.map((p) => p._id);
  const tasks = await Task.find({ project: { $in: ids } }).select("project columnId dueDate");
  const grouped = new Map();
  tasks.forEach((t) => {
    const key = String(t.project);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  });
  return projects.map((p) => ({
    ...p.toObject(),
    overdue: projectOverdue(p),
    stats: computeStats(p, grouped.get(String(p._id)) || []),
  }));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

const list = asyncHandler(async (req, res) => {
  await loadWorkspace(req.params.workspaceId, req.user._id);
  const projects = await Project.find({ workspace: req.params.workspaceId }).sort({ createdAt: -1 });
  res.json({ projects: await statsForProjects(projects) });
});

const create = asyncHandler(async (req, res) => {
  const { workspace } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const project = await Project.create({
    workspace: workspace._id,
    name: req.body.name,
    description: req.body.description || "",
    status: req.body.status || "active",
    dueDate: parseDate(req.body.dueDate) || undefined,
    owner: req.user._id,
    createdBy: req.user._id,
  });
  const io = req.app.get("io");
  const [withStats] = await statsForProjects([project]);
  emitToWorkspace(io, workspace._id, "project:created", { project: withStats });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    actor: req.user,
    action: "project.created",
    summary: `created project “${project.name}”`,
  });
  res.status(201).json({ project: withStats });
});

const getBoard = asyncHandler(async (req, res) => {
  const { project, membership } = await loadProject(req);
  const tasks = await Task.find({ project: project._id })
    .populate("assignees", USER_FIELDS)
    .populate("createdBy", "name")
    .populate("comments.author", "name avatarColor")
    .sort({ order: 1, createdAt: 1 });
  res.json({
    project: { ...project.toObject(), overdue: projectOverdue(project) },
    tasks,
    stats: computeStats(project, tasks),
    myRole: membership.role,
  });
});

const updateProject = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireManager(membership);
  const io = req.app.get("io");
  const previousStatus = project.status;
  const changes = [];

  if (req.body.name !== undefined && req.body.name !== project.name) {
    project.name = req.body.name;
    changes.push("renamed");
  }
  if (req.body.description !== undefined) project.description = req.body.description;
  if (req.body.dueDate !== undefined) {
    project.dueDate = parseDate(req.body.dueDate) || undefined;
    changes.push("changed the due date");
  }
  if (req.body.status !== undefined && req.body.status !== previousStatus) {
    project.status = req.body.status;
    project.completedAt = req.body.status === "completed" ? new Date() : undefined;
    changes.push(`set status to ${req.body.status.replace("_", " ")}`);
  }
  await project.save();

  const [withStats] = await statsForProjects([project]);
  emitToWorkspace(io, workspace._id, "project:updated", { project: withStats });

  if (changes.length) {
    await logActivity(io, {
      workspace: workspace._id,
      project: project._id,
      actor: req.user,
      action: "project.updated",
      summary: `${changes.join(", ")} on “${project.name}”`,
    });
  }
  if (project.status !== previousStatus) {
    const others = workspace.members.map((m) => getMemberUserId(m)).filter((id) => id !== String(req.user._id));
    if (others.length) {
      await notifyUsers(io, others, {
        type: "project.status",
        title: `${project.name} is now ${project.status.replace("_", " ")}`,
        body: `${req.user.name} updated the project status`,
        link: `/app/w/${workspace._id}/projects/${project._id}`,
      });
    }
  }
  res.json({ project: withStats });
});

const removeProject = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireManager(membership);
  const io = req.app.get("io");
  await Task.deleteMany({ project: project._id });
  await Activity.deleteMany({ project: project._id });
  await project.deleteOne();
  emitToWorkspace(io, workspace._id, "project:deleted", { projectId: String(project._id) });
  await logActivity(io, {
    workspace: workspace._id,
    actor: req.user,
    action: "project.deleted",
    summary: `deleted project “${project.name}”`,
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function notifyAssignees(io, { workspace, project, task, actor, ids, title, type }) {
  const targets = ids.filter((id) => String(id) !== String(actor._id));
  if (!targets.length) return null;
  return notifyUsers(io, targets, {
    type,
    title,
    body: `“${task.title}” in ${project.name}`,
    link: `/app/w/${workspace._id}/projects/${project._id}`,
  });
}

const createTask = asyncHandler(async (req, res) => {
  const { project, workspace } = await loadProject(req);
  const io = req.app.get("io");
  const columnId = req.body.columnId || project.columns[0]?.id || "todo";
  if (!project.columns.some((c) => c.id === columnId)) {
    throw new AppError("Unknown column", 400);
  }
  assertAssigneesInWorkspace(workspace, req.body.assignees || []);
  const last = await Task.findOne({ project: project._id, columnId }).sort({ order: -1 });
  const finished = doneColumnIds(project).includes(columnId);
  const task = await Task.create({
    workspace: project.workspace,
    project: project._id,
    title: req.body.title,
    description: req.body.description || "",
    columnId,
    order: (last?.order ?? -1) + 1,
    assignees: req.body.assignees || [],
    labels: req.body.labels || [],
    priority: req.body.priority || "medium",
    checklist: req.body.checklist || [],
    dueDate: parseDate(req.body.dueDate) || undefined,
    completedAt: finished ? new Date() : undefined,
    createdBy: req.user._id,
  });
  await populateTask(task);
  emitToWorkspace(io, project.workspace, "task:updated", {
    type: "created",
    projectId: String(project._id),
    task,
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    task: task._id,
    actor: req.user,
    action: "task.created",
    summary: `added “${task.title}” to ${project.name}`,
  });
  await notifyAssignees(io, {
    workspace,
    project,
    task,
    actor: req.user,
    ids: task.assignees.map((a) => a._id),
    type: "task.assigned",
    title: `${req.user.name} assigned you a task`,
  });
  res.status(201).json({ task });
});

const updateTask = asyncHandler(async (req, res) => {
  const { project, workspace } = await loadProject(req);
  assertObjectId(req.params.taskId, "task id");
  const io = req.app.get("io");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);

  if (req.body.columnId && !project.columns.some((c) => c.id === req.body.columnId)) {
    throw new AppError("Unknown column", 400);
  }
  if (req.body.assignees) assertAssigneesInWorkspace(workspace, req.body.assignees);

  const before = {
    columnId: task.columnId,
    priority: task.priority,
    assignees: task.assignees.map(String),
  };

  ["title", "description", "columnId", "order", "assignees", "labels", "priority"].forEach((key) => {
    if (req.body[key] !== undefined) task[key] = req.body[key];
  });
  if (req.body.dueDate !== undefined) task.dueDate = parseDate(req.body.dueDate);
  if (req.body.checklist !== undefined) {
    // Keep existing sub-document ids so clients can diff, new items get fresh ids.
    task.checklist = req.body.checklist.map((item) =>
      item._id && mongoose.isValidObjectId(item._id)
        ? { _id: item._id, text: item.text, done: item.done }
        : { text: item.text, done: item.done }
    );
  }

  const doneIds = doneColumnIds(project);
  const wasDone = doneIds.includes(before.columnId);
  const isDone = doneIds.includes(task.columnId);
  if (isDone && !wasDone) task.completedAt = new Date();
  if (!isDone && wasDone) task.completedAt = undefined;

  await task.save();
  await populateTask(task);
  emitToWorkspace(io, project.workspace, "task:updated", {
    type: "updated",
    projectId: String(project._id),
    task,
  });

  const base = { workspace: workspace._id, project: project._id, task: task._id, actor: req.user };
  const columnTitle = (id) => project.columns.find((c) => c.id === id)?.title || id;
  if (task.columnId !== before.columnId) {
    await logActivity(io, {
      ...base,
      action: isDone ? "task.completed" : "task.moved",
      summary: isDone
        ? `completed “${task.title}”`
        : `moved “${task.title}” to ${columnTitle(task.columnId)}`,
    });
    if (isDone) {
      const stakeholders = [task.createdBy._id || task.createdBy, ...task.assignees.map((a) => a._id || a)];
      await notifyAssignees(io, {
        workspace,
        project,
        task,
        actor: req.user,
        ids: stakeholders,
        type: "task.completed",
        title: `${req.user.name} completed a task`,
      });
    }
  } else if (task.priority !== before.priority) {
    await logActivity(io, {
      ...base,
      action: "task.priority",
      summary: `set “${task.title}” to ${task.priority} priority`,
    });
  }

  const added = task.assignees.map((a) => String(a._id)).filter((id) => !before.assignees.includes(id));
  if (added.length) {
    await logActivity(io, { ...base, action: "task.assigned", summary: `assigned “${task.title}”` });
    await notifyAssignees(io, {
      workspace,
      project,
      task,
      actor: req.user,
      ids: added,
      type: "task.assigned",
      title: `${req.user.name} assigned you a task`,
    });
  }
  res.json({ task });
});

const removeTask = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  assertObjectId(req.params.taskId, "task id");
  const existing = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!existing) throw new AppError("Task not found", 404);
  const isCreator = String(existing.createdBy) === String(req.user._id);
  if (!isCreator && !isManager(membership.role)) {
    throw new AppError("Only the creator or a workspace admin can delete this task", 403);
  }
  await existing.deleteOne();
  const io = req.app.get("io");
  emitToWorkspace(io, project.workspace, "task:updated", {
    type: "deleted",
    projectId: String(project._id),
    taskId: String(existing._id),
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    actor: req.user,
    action: "task.deleted",
    summary: `deleted “${existing.title}”`,
  });
  res.json({ ok: true });
});

const addComment = asyncHandler(async (req, res) => {
  const { project, workspace } = await loadProject(req);
  assertObjectId(req.params.taskId, "task id");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);
  const io = req.app.get("io");
  task.comments.push({ author: req.user._id, body: req.body.body });
  await task.save();
  await populateTask(task);
  emitToWorkspace(io, project.workspace, "task:updated", {
    type: "updated",
    projectId: String(project._id),
    task,
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    task: task._id,
    actor: req.user,
    action: "task.commented",
    summary: `commented on “${task.title}”`,
  });
  await notifyAssignees(io, {
    workspace,
    project,
    task,
    actor: req.user,
    ids: [task.createdBy._id || task.createdBy, ...task.assignees.map((a) => a._id)],
    type: "task.comment",
    title: `${req.user.name} commented on a task`,
  });
  res.status(201).json({ task });
});

const removeComment = asyncHandler(async (req, res) => {
  const { project, membership } = await loadProject(req);
  assertObjectId(req.params.taskId, "task id");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);
  const comment = task.comments.id(req.params.commentId);
  if (!comment) throw new AppError("Comment not found", 404);
  if (String(comment.author) !== String(req.user._id) && !isManager(membership.role)) {
    throw new AppError("You can only delete your own comments", 403);
  }
  comment.deleteOne();
  await task.save();
  await populateTask(task);
  emitToWorkspace(req.app.get("io"), project.workspace, "task:updated", {
    type: "updated",
    projectId: String(project._id),
    task,
  });
  res.json({ task });
});

const projectActivity = asyncHandler(async (req, res) => {
  const { project } = await loadProject(req);
  const items = await Activity.find({ project: project._id })
    .sort({ createdAt: -1 })
    .limit(40)
    .populate("actor", "name avatarColor");
  res.json({ activity: items });
});

/* ------------------------------------------------------------------ */
/* Workspace-level views                                               */
/* ------------------------------------------------------------------ */

const myTasks = asyncHandler(async (req, res) => {
  const { workspace } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const tasks = await Task.find({ workspace: workspace._id, assignees: req.user._id })
    .populate("project", "name columns status")
    .populate("assignees", USER_FIELDS)
    .sort({ dueDate: 1, createdAt: -1 });
  const shaped = tasks
    .filter((t) => t.project)
    .map((t) => {
      const finished = doneColumnIds(t.project).includes(t.columnId);
      const obj = t.toObject();
      obj.done = finished;
      obj.overdue = Boolean(!finished && t.dueDate && new Date(t.dueDate) < new Date());
      obj.doneColumnId = doneColumnIds(t.project)[0];
      obj.columnTitle = t.project.columns.find((c) => c.id === t.columnId)?.title || t.columnId;
      obj.project = { _id: t.project._id, name: t.project.name };
      return obj;
    });
  res.json({ tasks: shaped });
});

const dashboard = asyncHandler(async (req, res) => {
  const { workspace, membership } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const [projects, tasks, activity] = await Promise.all([
    Project.find({ workspace: workspace._id }).sort({ createdAt: -1 }),
    Task.find({ workspace: workspace._id }).select("project columnId dueDate assignees priority"),
    Activity.find({ workspace: workspace._id })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate("actor", "name avatarColor"),
  ]);

  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const totals = { projects: projects.length, tasks: 0, completed: 0, overdue: 0, open: 0 };
  const statusCounts = { planning: 0, active: 0, on_hold: 0, completed: 0 };
  projects.forEach((p) => (statusCounts[p.status] = (statusCounts[p.status] || 0) + 1));

  const workload = new Map(workspace.members.map((m) => [getMemberUserId(m), { open: 0, done: 0, overdue: 0 }]));
  const now = Date.now();
  for (const t of tasks) {
    const project = projectById.get(String(t.project));
    if (!project) continue;
    const finished = doneColumnIds(project).includes(t.columnId);
    totals.tasks += 1;
    if (finished) totals.completed += 1;
    else totals.open += 1;
    const late = !finished && t.dueDate && new Date(t.dueDate).getTime() < now;
    if (late) totals.overdue += 1;
    t.assignees.forEach((a) => {
      const slot = workload.get(String(a));
      if (!slot) return;
      if (finished) slot.done += 1;
      else slot.open += 1;
      if (late) slot.overdue += 1;
    });
  }
  totals.percent = totals.tasks ? Math.round((totals.completed / totals.tasks) * 100) : 0;

  const members = await Workspace.populate(workspace, { path: "members.user", select: USER_FIELDS });
  res.json({
    totals,
    statusCounts,
    projects: await statsForProjects(projects),
    workload: members.members.map((m) => ({
      user: m.user,
      role: m.role,
      ...(workload.get(String(m.user._id)) || { open: 0, done: 0, overdue: 0 }),
    })),
    activity,
    myRole: membership.role,
  });
});

const workspaceActivity = asyncHandler(async (req, res) => {
  const { workspace } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const items = await Activity.find({ workspace: workspace._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("actor", "name avatarColor");
  res.json({ activity: items });
});

module.exports = {
  createSchema,
  projectUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  commentSchema,
  list,
  create,
  getBoard,
  updateProject,
  removeProject,
  createTask,
  updateTask,
  removeTask,
  addComment,
  removeComment,
  projectActivity,
  myTasks,
  dashboard,
  workspaceActivity,
};
