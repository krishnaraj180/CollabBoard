const { z } = require("zod");
const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Sprint = require("../models/Sprint");
const Activity = require("../models/Activity");
const { PROJECT_STATUSES } = Project;
const { WORKFLOW_STAGES } = Project;
const { PRIORITIES } = Task;
const { AppError, asyncHandler } = require("../utils/errors");
const { requireMember, isManager, getMemberUserId, canAccessProject } = require("../utils/access");
const { emitToProjectWorkspace } = require("../sockets");
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
    projectManagerId: z.string().nullable().optional(),
    scope: z.string().max(4000).optional(),
    budget: z.number().min(0).nullable().optional(),
    milestones: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    departmentAssignments: z.array(z.object({
      department: z.string().trim().min(1).max(60),
      teamLeadId: z.string(),
      memberIds: z.array(z.string()).max(100).default([]),
    })).max(20).optional(),
  }),
});

const projectTeamMembersSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    department: z.string().trim().min(1).max(60),
    memberIds: z.array(z.string()).min(1).max(100),
  }),
});

const workflowTransitionSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    action: z.enum(["approve", "submit", "complete", "request_changes", "pass", "fail", "deploy", "release", "launch"]),
    note: z.string().max(1000).optional().default(""),
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
    startDate: dateField,
    dueDate: dateField,
    progress: z.number().int().min(0).max(100).optional(),
    sprintId: z.string().nullable().optional(),
    dependencies: z.array(z.string()).max(100).optional(),
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
    startDate: dateField,
    dueDate: dateField,
    progress: z.number().int().min(0).max(100).optional(),
    sprintId: z.string().nullable().optional(),
    dependencies: z.array(z.string()).max(100).optional(),
  }),
});

const taskReorderSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    moves: z.array(z.object({
      taskId: z.string(),
      columnId: z.string(),
      order: z.number().int().min(0).max(10000),
    })).min(1).max(500),
  }),
});

const sprintCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80),
    goal: z.string().trim().max(1000).optional().default(""),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }),
});

const sprintUpdateSchema = z.object({
  params: z.object({ id: z.string(), sprintId: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    goal: z.string().trim().max(1000).optional(),
    startDate: z.string().min(1).optional(),
    endDate: z.string().min(1).optional(),
  }),
});

const milestoneCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional().default(""),
    dueDate: dateField,
  }),
});

const milestoneUpdateSchema = z.object({
  params: z.object({ id: z.string(), milestoneId: z.string() }),
  body: z.object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    dueDate: dateField,
    progress: z.number().int().min(0).max(100).optional(),
  }),
});

const emptyBodySchema = z.object({
  params: z.object({ id: z.string(), sprintId: z.string().optional(), milestoneId: z.string().optional() }),
  body: z.object({}).optional().default({}),
});

const commentSchema = z.object({
  params: z.object({ id: z.string(), taskId: z.string() }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const USER_FIELDS = "name email avatarColor";
const DEPARTMENT_MEMBER_ROLES = {
  "Development Department": ["engineering_manager", "development_team_lead", "team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  "Frontend Team": ["development_team_lead", "team_lead", "frontend_developer", "react_developer", "ui_developer"],
  "Backend Team": ["development_team_lead", "team_lead", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  "QA Department": ["qa_manager", "qa_team_lead", "qa_engineer"],
  "Design Department": ["design_manager", "design_team_lead", "ui_ux_designer"],
  "DevOps Department": ["devops_manager", "devops_team_lead", "devops_engineer"],
  "Finance Department": ["finance_manager", "accountant", "finance_executive", "finance"],
  "Marketing Department": ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"],
  "HR Department": ["hr_manager", "hr_executive", "recruiter", "hr_employee"],
  "Project Management": ["project_manager"],
};

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

function assertTaskDateRange(startDate, dueDate) {
  if (startDate && dueDate && dueDate < startDate) {
    throw new AppError("Task due date must be on or after its start date", 400);
  }
}

function assertSprintDateRange(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) {
    throw new AppError("Sprint end date must be after its start date", 400);
  }
}

async function ensureBacklogColumn(project) {
  if (project.columns.some((column) => column.id === "backlog")) return;
  const existing = [...project.columns]
    .sort((a, b) => a.order - b.order)
    .map((column, index) => ({
      id: column.id,
      title: column.title,
      order: index + 1,
      done: column.done,
    }));
  project.columns = [{ id: "backlog", title: "Backlog", order: 0 }, ...existing];
  await project.save();
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
  if (!canAccessProject(project, membership, req.user._id)) {
    throw new AppError("You are not assigned to this project or its current approval step", 403);
  }
  return { project, workspace, membership };
}

function requireManager(membership) {
  if (!isManager(membership.role)) {
    throw new AppError("Only workspace leadership can do this", 403);
  }
}

function canManageAssignedProject(project, membership, userId) {
  return isManager(membership.role) ||
    (membership.role === "project_manager" && String(project.projectManager?._id || project.projectManager) === String(userId));
}

function requireProjectPlanner(project, membership, userId) {
  if (!canManageAssignedProject(project, membership, userId)) {
    throw new AppError("Only workspace leadership or the assigned project manager can manage this project plan", 403);
  }
}

async function resolveSprint(projectId, sprintId, currentSprintId = null) {
  if (sprintId === null || sprintId === "") return null;
  assertObjectId(sprintId, "sprint id");
  const sprint = await Sprint.findOne({ _id: sprintId, project: projectId });
  if (!sprint) throw new AppError("Sprint not found in this project", 400);
  if (sprint.status === "completed" && String(sprint._id) !== String(currentSprintId || "")) {
    throw new AppError("Tasks cannot be assigned to a completed sprint", 409);
  }
  return sprint._id;
}

async function validateTaskDependencies(projectId, taskId, dependencyIds) {
  const ids = [...new Set(dependencyIds.map(String))];
  ids.forEach((id) => assertObjectId(id, "dependency task id"));
  const taskIdString = taskId ? String(taskId) : null;
  if (taskIdString && ids.includes(taskIdString)) {
    throw new AppError("A task cannot depend on itself", 400);
  }
  if (!ids.length) return [];

  const matching = await Task.find({ project: projectId, _id: { $in: ids } }).select("_id");
  if (matching.length !== ids.length) {
    throw new AppError("Dependencies must belong to this project", 400);
  }
  if (!taskIdString) return ids;

  const rows = await Task.find({ project: projectId }).select("_id dependencies").lean();
  const graph = new Map(rows.map((row) => [String(row._id), (row.dependencies || []).map(String)]));
  graph.set(taskIdString, ids);
  function reaches(currentId, targetId, visited = new Set()) {
    if (currentId === targetId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    return (graph.get(currentId) || []).some((nextId) => reaches(nextId, targetId, visited));
  }
  if (ids.some((id) => reaches(id, taskIdString))) {
    throw new AppError("Task dependencies cannot contain a cycle", 400);
  }
  return ids;
}

async function notifyProjectStakeholders(io, workspace, project, actor, update) {
  const targets = workspace.members
    .filter((member) => canAccessProject(project, member, getMemberUserId(member)))
    .map((member) => getMemberUserId(member));
  await notifyUsers(io, targets.filter((id) => id !== String(actor._id)), {
    type: "project.update",
    title: `${project.name} was updated`,
    body: `${actor.name} ${update}`,
    link: `/app/w/${workspace._id}/projects/${project._id}`,
  });
}

function requireWritableMember(membership) {
  if (membership.role === "viewer") {
    throw new AppError("Viewers have read-only access", 403);
  }
}

const TASK_STAGE_ROLES = {
  design: ["design_manager", "design_team_lead", "ui_ux_designer"],
  development: [
    "engineering_manager",
    "team_lead",
    "development_team_lead",
    "frontend_developer",
    "react_developer",
    "ui_developer",
    "backend_developer",
    "nodejs_developer",
    "java_developer",
    "python_developer",
  ],
  bug_fixing: [
    "engineering_manager",
    "team_lead",
    "development_team_lead",
    "frontend_developer",
    "react_developer",
    "ui_developer",
    "backend_developer",
    "nodejs_developer",
    "java_developer",
    "python_developer",
  ],
};

function isAssignedToDepartments(project, userId, departments) {
  const expected = new Set(departments.map((department) => department.toLowerCase()));
  return project.departmentAssignments.some((assignment) =>
    expected.has(assignment.department.toLowerCase()) &&
    (String(assignment.teamLead) === String(userId) ||
      (assignment.members || []).some((memberId) => String(memberId) === String(userId)))
  );
}

function requireTaskWorkStage(project, membership, userId) {
  const roles = TASK_STAGE_ROLES[project.workflowStage];
  if (!roles) throw new AppError("Task changes are available during design, development, and bug fixing stages", 409);
  if (isManager(membership.role) || membership.role === "project_manager") return;
  if (!roles.includes(membership.role)) {
    throw new AppError(`Your role cannot edit tasks during ${workflowLabels[project.workflowStage]}`, 403);
  }
  const departments = project.workflowStage === "design"
    ? ["Design Department"]
    : ["Development Department", "Frontend Team", "Backend Team"];
  if (!isAssignedToDepartments(project, userId, departments)) {
    throw new AppError("You are not assigned to this project's active department", 403);
  }
}

const WORKFLOW_TRANSITIONS = {
  business_approval: { action: "approve", next: "technical_review", roles: ["managing_director"] },
  technical_review: { action: "approve", next: "project_setup", roles: ["cto"] },
  project_setup: { action: "submit", next: "team_assignment", roles: ["project_manager"] },
  team_assignment: { action: "submit", next: "design", roles: ["project_manager"] },
  design: { action: "complete", next: "development", departments: ["Design Department"], roles: ["design_manager", "design_team_lead", "ui_ux_designer"] },
  development: { action: "complete", next: "code_review", departments: ["Development Department", "Frontend Team", "Backend Team"], roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] },
  code_review: { action: "approve", next: "qa_testing", departments: ["Development Department"], roles: ["engineering_manager", "team_lead", "development_team_lead"] },
  qa_testing: { action: "pass", next: "deployment", departments: ["QA Department"], roles: ["qa_manager", "qa_team_lead", "qa_engineer"] },
  bug_fixing: { action: "complete", next: "code_review", departments: ["Development Department", "Frontend Team", "Backend Team"], roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] },
  deployment: { action: "deploy", next: "production_release", departments: ["DevOps Department"], roles: ["devops_manager", "devops_team_lead", "devops_engineer"] },
  production_release: { action: "release", next: "marketing_launch", departments: ["DevOps Department"], roles: ["devops_manager", "devops_team_lead", "devops_engineer"] },
  marketing_launch: { action: "launch", next: "finance_review", departments: ["Marketing Department"], roles: ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"] },
  finance_review: { action: "complete", next: "delivery_review", departments: ["Finance Department"], roles: ["finance_manager", "accountant", "finance_executive", "finance"] },
  delivery_review: { action: "complete", next: "executive_review", roles: ["project_manager"] },
  executive_review: { action: "complete", next: "completed", roles: ["ceo", "managing_director"] },
};

const workflowLabels = {
  business_approval: "MD business approval",
  technical_review: "CTO technical review",
  project_setup: "Project scope and planning",
  team_assignment: "Department and team assignment",
  design: "Design",
  development: "Development",
  code_review: "Code review and integration",
  qa_testing: "QA testing",
  bug_fixing: "Bug fixing",
  deployment: "DevOps deployment",
  production_release: "Production release",
  marketing_launch: "Marketing launch",
  finance_review: "Finance review",
  delivery_review: "PM delivery review",
  executive_review: "CEO/MD final review",
  completed: "Project completed",
};

function assertWorkflowRole(membership, allowedRoles, project, userId, departments = []) {
  if (!allowedRoles.includes(membership.role) && membership.role !== "owner") {
    throw new AppError(`This workflow step requires: ${allowedRoles.join(" or ")}`, 403);
  }
  if (membership.role !== "owner" && departments.length && !isAssignedToDepartments(project, userId, departments)) {
    throw new AppError("You are not assigned to the department responsible for this workflow step", 403);
  }
}

const transitionWorkflow = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  const transition = WORKFLOW_TRANSITIONS[project.workflowStage];
  const stageActions = project.workflowStage === "qa_testing"
    ? ["pass", "fail"]
    : project.workflowStage === "code_review"
      ? ["approve", "request_changes"]
      : transition
        ? [transition.action]
        : [];
  if (!transition || !stageActions.includes(req.body.action)) {
    throw new AppError(`Action is not valid during ${workflowLabels[project.workflowStage] || project.workflowStage}`, 409);
  }
  assertWorkflowRole(membership, transition.roles, project, req.user._id, transition.departments);

  if (project.workflowStage === "project_setup") {
    if (!project.scope.trim() || project.budget === null || !project.dueDate || !project.milestones.length) {
      throw new AppError("Set the scope, budget, timeline, and at least one milestone before submitting", 400);
    }
  }
  if (project.workflowStage === "team_assignment" && !project.departmentAssignments.length) {
    throw new AppError("Assign at least one department and team lead before submitting", 400);
  }
  if (project.workflowStage === "qa_testing" && req.body.action === "fail" && !req.body.note.trim()) {
    throw new AppError("Describe the QA failure so a bug task can be created", 400);
  }
  if (project.workflowStage === "code_review" && req.body.action === "request_changes" && !req.body.note.trim()) {
    throw new AppError("Describe the changes required", 400);
  }

  const priorStage = project.workflowStage;
  const nextStage = priorStage === "qa_testing" && req.body.action === "fail"
    ? "bug_fixing"
    : priorStage === "code_review" && req.body.action === "request_changes"
      ? "development"
      : transition.next;
  if (priorStage === "qa_testing" && req.body.action === "fail") {
    const developmentMembers = project.departmentAssignments
      .filter((assignment) => ["frontend team", "backend team"].includes(assignment.department.toLowerCase()))
      .flatMap((assignment) => assignment.members || []);
    const bug = await Task.create({
      workspace: project.workspace,
      project: project._id,
      title: `QA bug: ${req.body.note.trim().slice(0, 130)}`,
      description: req.body.note.trim(),
      labels: ["bug"],
      assignees: [...new Set(developmentMembers.map(String))],
      createdBy: req.user._id,
    });
    await populateTask(bug);
    emitToProjectWorkspace(req.app.get("io"), workspace.members, project, "task:updated", {
      type: "created",
      projectId: String(project._id),
      task: bug,
    });
    await notifyAssignees(req.app.get("io"), {
      workspace,
      project,
      task: bug,
      actor: req.user,
      ids: bug.assignees.map((assignee) => assignee._id),
      type: "task.assigned",
      title: "QA created a bug task for your team",
    });
    await logActivity(req.app.get("io"), {
      workspace: workspace._id,
      project: project._id,
      projectManager: project.projectManager,
      projectAssignments: project.departmentAssignments,
      workflowStage: project.workflowStage,
      workspaceMembers: workspace.members,
      task: bug._id,
      actor: req.user,
      action: "task.qa_bug_created",
      summary: `created a QA bug task: “${bug.title}”`,
    });
  }

  project.workflowHistory.push({
    stage: priorStage,
    action: req.body.action,
    actor: req.user._id,
    note: req.body.note.trim(),
  });
  project.workflowStage = nextStage;
  if (nextStage === "completed") {
    project.status = "completed";
    project.completedAt = new Date();
  }
  await project.save();

  const populated = await project.populate([
    { path: "projectManager", select: USER_FIELDS },
    { path: "workflowHistory.actor", select: "name avatarColor" },
    { path: "departmentAssignments.teamLead", select: USER_FIELDS },
    { path: "departmentAssignments.members", select: USER_FIELDS },
  ]);
  const io = req.app.get("io");
  emitToProjectWorkspace(io, workspace.members, project, "project:updated", { project: populated });
  const actionSummary = {
    approve: "approved",
    submit: "submitted",
    complete: "completed",
    request_changes: "requested changes",
    pass: "passed QA",
    fail: "failed QA",
    deploy: "deployed",
    release: "released",
    launch: "launched",
  }[req.body.action];
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
    actor: req.user,
    action: "project.workflow",
    summary: `${workflowLabels[priorStage]} ${actionSummary}; next: ${workflowLabels[nextStage]}`,
  });
  await notifyProjectStakeholders(io, workspace, project, req.user, `moved to ${workflowLabels[nextStage]}`);
  res.json({ project: populated });
});

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
    { path: "sprint", select: "name goal startDate endDate status" },
    { path: "dependencies", select: "title columnId startDate dueDate progress" },
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

async function findAccessibleProjects(workspaceId, membership, userId) {
  const projects = await Project.find({ workspace: workspaceId })
    .populate("projectManager", USER_FIELDS)
    .sort({ createdAt: -1 });
  return projects.filter((project) => canAccessProject(project, membership, userId));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

const list = asyncHandler(async (req, res) => {
  const { membership } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const projects = await findAccessibleProjects(req.params.workspaceId, membership, req.user._id);
  res.json({ projects: await statsForProjects(projects) });
});

const create = asyncHandler(async (req, res) => {
  const { workspace, membership } = await loadWorkspace(req.params.workspaceId, req.user._id);
  requireWritableMember(membership);
  if (!isManager(membership.role) && membership.role !== "project_manager") {
    throw new AppError("Only workspace leadership or project managers can create a project", 403);
  }
  if (req.body.status === "completed") {
    throw new AppError("Projects must complete the workflow before being marked complete", 409);
  }
  const project = await Project.create({
    workspace: workspace._id,
    name: req.body.name,
    description: req.body.description || "",
    status: req.body.status || "active",
    dueDate: parseDate(req.body.dueDate) || undefined,
    projectManager: membership.role === "project_manager" ? req.user._id : null,
    owner: req.user._id,
    createdBy: req.user._id,
  });
  const io = req.app.get("io");
  const [withStats] = await statsForProjects([project]);
  emitToProjectWorkspace(io, workspace.members, project, "project:created", { project: withStats });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
    actor: req.user,
    action: "project.created",
    summary: `created project “${project.name}”`,
  });
  if (membership.role === "project_manager") {
    await notifyProjectStakeholders(io, workspace, project, req.user, "created the project");
  }
  res.status(201).json({ project: withStats });
});

const getBoard = asyncHandler(async (req, res) => {
  const { project, membership } = await loadProject(req);
  await ensureBacklogColumn(project);
  await project.populate([
    { path: "projectManager", select: USER_FIELDS },
    { path: "workflowHistory.actor", select: "name avatarColor" },
    { path: "departmentAssignments.teamLead", select: USER_FIELDS },
    { path: "departmentAssignments.members", select: USER_FIELDS },
  ]);
  const tasks = await Task.find({ project: project._id })
    .populate("assignees", USER_FIELDS)
    .populate("createdBy", "name")
    .populate("comments.author", "name avatarColor")
    .populate("sprint", "name goal startDate endDate status")
    .populate("dependencies", "title columnId startDate dueDate progress")
    .sort({ order: 1, createdAt: 1 });
  res.json({
    project: { ...project.toObject(), overdue: projectOverdue(project) },
    tasks,
    stats: computeStats(project, tasks),
    myRole: membership.role,
    canManageProject: canManageAssignedProject(project, membership, req.user._id),
  });
});

const updateProject = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  const canManageProject = canManageAssignedProject(project, membership, req.user._id);
  if (!canManageProject) requireManager(membership);
  const io = req.app.get("io");
  const previousStatus = project.status;
  const changes = [];

  if (req.body.name !== undefined && req.body.name !== project.name) {
    project.name = req.body.name;
    changes.push("renamed");
  }
  if (req.body.description !== undefined && req.body.description !== project.description) {
    project.description = req.body.description;
    changes.push("updated the description");
  }
  if (req.body.dueDate !== undefined) {
    const dueDate = parseDate(req.body.dueDate) || undefined;
    if (String(dueDate || "") !== String(project.dueDate || "")) {
      project.dueDate = dueDate;
      changes.push("changed the due date");
    }
  }
  if (req.body.status !== undefined && req.body.status !== previousStatus) {
    if (req.body.status === "completed" && project.workflowStage !== "completed") {
      throw new AppError("Complete the required workflow reviews before completing this project", 409);
    }
    project.status = req.body.status;
    project.completedAt = req.body.status === "completed" ? new Date() : undefined;
    changes.push(`set status to ${req.body.status.replace("_", " ")}`);
  }
  if (req.body.projectManagerId !== undefined) {
    requireManager(membership);
    if (req.body.projectManagerId !== null) {
      assertObjectId(req.body.projectManagerId, "project manager id");
      const selectedManager = workspace.members.find((member) =>
        getMemberUserId(member) === req.body.projectManagerId && member.role === "project_manager"
      );
      if (!selectedManager) throw new AppError("Project managers must have the project manager workspace role", 400);
    }
    const nextManagerId = req.body.projectManagerId;
    if (String(project.projectManager?._id || project.projectManager || "") !== String(nextManagerId || "")) {
      project.projectManager = nextManagerId;
      changes.push(nextManagerId ? "assigned a project manager" : "removed the project manager");
    }
  }
  if (["scope", "budget", "milestones"].some((key) => req.body[key] !== undefined)) {
    if (project.workflowStage !== "project_setup" ||
      (membership.role !== "project_manager" && !isManager(membership.role))) {
      throw new AppError("Only the assigned project manager can edit project planning details during project setup", 403);
    }
    if (req.body.scope !== undefined) project.scope = req.body.scope;
    if (req.body.budget !== undefined) project.budget = req.body.budget;
    if (req.body.milestones !== undefined) project.milestones = req.body.milestones;
  }
  if (req.body.departmentAssignments !== undefined) {
    if (project.workflowStage !== "team_assignment" ||
      (membership.role !== "project_manager" && !isManager(membership.role))) {
      throw new AppError("Only the assigned project manager can assign teams during the team assignment stage", 403);
    }
    const workspaceMembers = new Map(workspace.members.map((member) => [getMemberUserId(member), member]));
    project.departmentAssignments = req.body.departmentAssignments.map((assignment) => {
      const { department, teamLeadId, memberIds } = assignment;
      if (!workspace.organization.departments.some((item) => item.name === department)) {
        throw new AppError(`Unknown department: ${department}`, 400);
      }
      const lead = workspaceMembers.get(teamLeadId);
      const departmentLeadRoles = {
        "Development Department": ["engineering_manager", "development_team_lead"],
        "Frontend Team": ["development_team_lead", "team_lead"],
        "Backend Team": ["development_team_lead", "team_lead"],
        "QA Department": ["qa_manager", "qa_team_lead"],
        "Design Department": ["design_manager", "design_team_lead"],
        "HR Department": ["hr_manager"],
        "DevOps Department": ["devops_manager", "devops_team_lead"],
        "Marketing Department": ["marketing_manager", "marketing"],
        "Finance Department": ["finance_manager", "finance"],
        "Project Management": ["project_manager"],
      };
      const allowedLeadRoles = departmentLeadRoles[department] || [];
      if (!lead || !allowedLeadRoles.includes(lead.role)) {
        throw new AppError(`Choose a team lead with the ${department} role`, 400);
      }
      const members = [...new Set(memberIds)];
      if (members.some((id) => !workspaceMembers.has(id))) {
        throw new AppError("Assigned team members must belong to this workspace", 400);
      }
      if (members.some((id) => !DEPARTMENT_MEMBER_ROLES[department]?.includes(workspaceMembers.get(id).role))) {
        throw new AppError(`Team members assigned to ${department} must have a matching department role`, 400);
      }
      return { department, teamLead: teamLeadId, members };
    });
  }
  await project.save();

  await project.populate("projectManager", USER_FIELDS);
  const [withStats] = await statsForProjects([project]);
  emitToProjectWorkspace(io, workspace.members, project, "project:updated", { project: withStats });

  if (changes.length) {
    await logActivity(io, {
      workspace: workspace._id,
      project: project._id,
      projectManager: project.projectManager,
      projectAssignments: project.departmentAssignments,
      workflowStage: project.workflowStage,
      workspaceMembers: workspace.members,
      actor: req.user,
      action: "project.updated",
      summary: `${changes.join(", ")} on “${project.name}”`,
    });
    await notifyProjectStakeholders(io, workspace, project, req.user, changes.join(", "));
  }
  res.json({ project: withStats });
});

const addProjectTeamMembers = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  if (!canManageAssignedProject(project, membership, req.user._id)) {
    throw new AppError("Only workspace leadership or the assigned project manager can add team members", 403);
  }
  if (!["design", "development", "bug_fixing"].includes(project.workflowStage)) {
    throw new AppError("Team members can be added during design, development, or bug fixing", 409);
  }

  const { department, memberIds } = req.body;
  const assignment = project.departmentAssignments.find((item) => item.department === department);
  if (!assignment) throw new AppError("This department is not assigned to the project", 400);

  const workspaceMembers = new Map(workspace.members.map((member) => [getMemberUserId(member), member]));
  const addedMemberIds = [];
  for (const id of new Set(memberIds)) {
    assertObjectId(id, "member id");
    const member = workspaceMembers.get(id);
    if (!member) throw new AppError("Team members must belong to this workspace", 400);
    if (member.department !== department) {
      throw new AppError(`Assign the member to ${department} in workspace settings first`, 400);
    }
    if (!DEPARTMENT_MEMBER_ROLES[department]?.includes(member.role)) {
      throw new AppError(`Team members assigned to ${department} must have a matching department role`, 400);
    }

    const alreadyAssigned = String(assignment.teamLead) === id ||
      assignment.members.some((memberId) => String(memberId) === id);
    if (!alreadyAssigned) {
      assignment.members.push(id);
      addedMemberIds.push(id);
    }
  }

  let io;
  let summary;
  if (addedMemberIds.length) {
    await project.save();
    io = req.app.get("io");
    summary = `added ${addedMemberIds.length} member${addedMemberIds.length === 1 ? "" : "s"} to ${department}`;
    await logActivity(io, {
      workspace: workspace._id,
      project: project._id,
      projectManager: project.projectManager,
      projectAssignments: project.departmentAssignments,
      workflowStage: project.workflowStage,
      workspaceMembers: workspace.members,
      actor: req.user,
      action: "project.team_members_added",
      summary,
    });
    await notifyProjectStakeholders(io, workspace, project, req.user, summary);
  }

  await project.populate([
    { path: "projectManager", select: USER_FIELDS },
    { path: "departmentAssignments.teamLead", select: USER_FIELDS },
    { path: "departmentAssignments.members", select: USER_FIELDS },
  ]);
  const [withStats] = await statsForProjects([project]);
  if (addedMemberIds.length) {
    emitToProjectWorkspace(io, workspace.members, project, "project:updated", { project: withStats });
  }
  res.json({ project: withStats, addedMemberIds });
});

const removeProject = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireManager(membership);
  const io = req.app.get("io");
  await Task.deleteMany({ project: project._id });
  await Sprint.deleteMany({ project: project._id });
  await Activity.deleteMany({ project: project._id });
  await project.deleteOne();
  emitToProjectWorkspace(io, workspace.members, project, "project:deleted", { projectId: String(project._id) });
  await logActivity(io, {
    workspace: workspace._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
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
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  requireTaskWorkStage(project, membership, req.user._id);
  const io = req.app.get("io");
  const columnId = req.body.columnId || project.columns[0]?.id || "todo";
  if (!project.columns.some((c) => c.id === columnId)) {
    throw new AppError("Unknown column", 400);
  }
  assertAssigneesInWorkspace(workspace, req.body.assignees || []);
  const startDate = parseDate(req.body.startDate);
  const dueDate = parseDate(req.body.dueDate);
  assertTaskDateRange(startDate, dueDate);
  const sprint = req.body.sprintId === undefined ? null : await resolveSprint(project._id, req.body.sprintId);
  const dependencies = await validateTaskDependencies(project._id, null, req.body.dependencies || []);
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
    startDate: startDate || undefined,
    dueDate: dueDate || undefined,
    progress: req.body.progress ?? (finished ? 100 : 0),
    sprint,
    dependencies,
    completedAt: finished ? new Date() : undefined,
    createdBy: req.user._id,
  });
  await populateTask(task);
  emitToProjectWorkspace(io, workspace.members, project, "task:updated", {
    type: "created",
    projectId: String(project._id),
    task,
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
    task: task._id,
    actor: req.user,
    action: "task.created",
    summary: `added “${task.title}” to ${project.name}`,
  });
  await notifyProjectStakeholders(io, workspace, project, req.user, `added a task to ${project.name}`);
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
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  requireTaskWorkStage(project, membership, req.user._id);
  assertObjectId(req.params.taskId, "task id");
  const io = req.app.get("io");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);

  if (req.body.columnId && !project.columns.some((c) => c.id === req.body.columnId)) {
    throw new AppError("Unknown column", 400);
  }
  if (req.body.assignees) assertAssigneesInWorkspace(workspace, req.body.assignees);
  const startDate = req.body.startDate === undefined ? task.startDate : parseDate(req.body.startDate);
  const dueDate = req.body.dueDate === undefined ? task.dueDate : parseDate(req.body.dueDate);
  assertTaskDateRange(startDate, dueDate);
  const sprint = req.body.sprintId === undefined
    ? task.sprint
    : await resolveSprint(project._id, req.body.sprintId, task.sprint);
  const dependencies = req.body.dependencies === undefined
    ? task.dependencies
    : await validateTaskDependencies(project._id, task._id, req.body.dependencies);

  const before = {
    columnId: task.columnId,
    priority: task.priority,
    assignees: task.assignees.map(String),
  };

  ["title", "description", "columnId", "order", "assignees", "labels", "priority", "progress"].forEach((key) => {
    if (req.body[key] !== undefined) task[key] = req.body[key];
  });
  if (req.body.columnId !== undefined && req.body.columnId !== before.columnId && req.body.order === undefined) {
    const lastInColumn = await Task.findOne({
      project: project._id,
      columnId: req.body.columnId,
      _id: { $ne: task._id },
    }).sort({ order: -1 });
    task.order = (lastInColumn?.order ?? -1) + 1;
  }
  task.startDate = startDate;
  task.dueDate = dueDate;
  task.sprint = sprint;
  task.dependencies = dependencies;
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
  if (req.body.progress === undefined && isDone !== wasDone) {
    task.progress = isDone ? 100 : 0;
  }
  if (isDone && !wasDone) task.completedAt = new Date();
  if (!isDone && wasDone) task.completedAt = undefined;

  await task.save();
  await populateTask(task);
  emitToProjectWorkspace(io, workspace.members, project, "task:updated", {
    type: "updated",
    projectId: String(project._id),
    task,
  });

  const base = {
    workspace: workspace._id,
    project: project._id,
    task: task._id,
    actor: req.user,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
  };
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
    await notifyProjectStakeholders(io, workspace, project, req.user, `moved “${task.title}” to ${columnTitle(task.columnId)}`);
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

const reorderTasks = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  requireTaskWorkStage(project, membership, req.user._id);

  const ids = req.body.moves.map((move) => {
    assertObjectId(move.taskId, "task id");
    if (!project.columns.some((column) => column.id === move.columnId)) {
      throw new AppError("Unknown column", 400);
    }
    return new mongoose.Types.ObjectId(move.taskId).toString();
  });
  if (new Set(ids).size !== ids.length) {
    throw new AppError("A task can only appear once in a reorder request", 400);
  }
  const tasks = await Task.find({ project: project._id, _id: { $in: ids } });
  if (tasks.length !== ids.length) throw new AppError("Tasks must belong to this project", 400);

  const moves = new Map(req.body.moves.map((move) => [new mongoose.Types.ObjectId(move.taskId).toString(), move]));
  const doneIds = new Set(doneColumnIds(project));
  const io = req.app.get("io");
  for (const task of tasks) {
    const move = moves.get(String(task._id));
    const previousColumnId = task.columnId;
    const wasDone = doneIds.has(task.columnId);
    const isDone = doneIds.has(move.columnId);
    const destinationTitle = project.columns.find((column) => column.id === move.columnId)?.title || move.columnId;
    if (task.columnId !== move.columnId) {
      task.columnId = move.columnId;
      if (isDone !== wasDone) {
        task.progress = isDone ? 100 : 0;
        task.completedAt = isDone ? new Date() : undefined;
      }
    }
    task.order = move.order;
    await task.save();
    await populateTask(task);
    emitToProjectWorkspace(io, workspace.members, project, "task:updated", {
      type: "updated",
      projectId: String(project._id),
      task,
    });
    if (previousColumnId !== move.columnId) {
      await logActivity(io, {
        workspace: workspace._id,
        project: project._id,
        projectManager: project.projectManager,
        projectAssignments: project.departmentAssignments,
        workflowStage: project.workflowStage,
        workspaceMembers: workspace.members,
        task: task._id,
        actor: req.user,
        action: isDone ? "task.completed" : "task.moved",
        summary: isDone
          ? `completed “${task.title}”`
          : `moved “${task.title}” to ${destinationTitle}`,
      });
      if (isDone && !wasDone) {
        await notifyAssignees(io, {
          workspace,
          project,
          task,
          actor: req.user,
          ids: [task.createdBy._id || task.createdBy, ...task.assignees.map((assignee) => assignee._id || assignee)],
          type: "task.completed",
          title: `${req.user.name} completed a task`,
        });
      }
      await notifyProjectStakeholders(io, workspace, project, req.user, `moved “${task.title}” to ${destinationTitle}`);
    }
  }
  res.json({ tasks });
});

async function recordPlanningUpdate(req, workspace, project, event, data, action, summary) {
  const io = req.app.get("io");
  emitToProjectWorkspace(io, workspace.members, project, event, {
    projectId: String(project._id),
    ...data,
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
    actor: req.user,
    action,
    summary,
  });
}

async function sprintProgress(project, sprints) {
  const doneIds = new Set(doneColumnIds(project));
  const progressBySprint = new Map(sprints.map((sprint) => [String(sprint._id), { total: 0, completed: 0 }]));
  if (sprints.length) {
    const tasks = await Task.find({
      project: project._id,
      sprint: { $in: sprints.map((sprint) => sprint._id) },
    }).select("sprint columnId").lean();
    for (const task of tasks) {
      const stats = progressBySprint.get(String(task.sprint));
      if (!stats) continue;
      stats.total += 1;
      if (doneIds.has(task.columnId)) stats.completed += 1;
    }
  }
  return sprints.map((sprint) => {
    const stats = progressBySprint.get(String(sprint._id));
    return {
      ...sprint.toObject(),
      taskCount: stats.total,
      completedTaskCount: stats.completed,
      progress: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0,
    };
  });
}

const listSprints = asyncHandler(async (req, res) => {
  const { project } = await loadProject(req);
  const sprints = await Sprint.find({ project: project._id }).sort({ startDate: -1, createdAt: -1 });
  res.json({ sprints: await sprintProgress(project, sprints) });
});

const createSprint = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  const startDate = parseDate(req.body.startDate);
  const endDate = parseDate(req.body.endDate);
  assertSprintDateRange(startDate, endDate);
  const sprint = await Sprint.create({
    workspace: workspace._id,
    project: project._id,
    name: req.body.name,
    goal: req.body.goal,
    startDate,
    endDate,
    createdBy: req.user._id,
  });
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "sprint:updated",
    { type: "created", sprint },
    "sprint.created",
    `created sprint “${sprint.name}”`
  );
  const [withProgress] = await sprintProgress(project, [sprint]);
  res.status(201).json({ sprint: withProgress });
});

const updateSprint = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.sprintId, "sprint id");
  const sprint = await Sprint.findOne({ _id: req.params.sprintId, project: project._id });
  if (!sprint) throw new AppError("Sprint not found", 404);
  if (sprint.status === "completed") throw new AppError("Completed sprints cannot be edited", 409);

  const startDate = req.body.startDate === undefined ? sprint.startDate : parseDate(req.body.startDate);
  const endDate = req.body.endDate === undefined ? sprint.endDate : parseDate(req.body.endDate);
  assertSprintDateRange(startDate, endDate);
  if (req.body.name !== undefined) sprint.name = req.body.name;
  if (req.body.goal !== undefined) sprint.goal = req.body.goal;
  sprint.startDate = startDate;
  sprint.endDate = endDate;
  await sprint.save();
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "sprint:updated",
    { type: "updated", sprint },
    "sprint.updated",
    `updated sprint “${sprint.name}”`
  );
  const [withProgress] = await sprintProgress(project, [sprint]);
  res.json({ sprint: withProgress });
});

const startSprint = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.sprintId, "sprint id");
  const sprint = await Sprint.findOne({ _id: req.params.sprintId, project: project._id });
  if (!sprint) throw new AppError("Sprint not found", 404);
  if (sprint.status !== "planned") throw new AppError("Only planned sprints can be started", 409);
  const activeSprint = await Sprint.findOne({ project: project._id, status: "active" });
  if (activeSprint) throw new AppError("Complete the active sprint before starting another", 409);
  sprint.status = "active";
  sprint.startedAt = new Date();
  try {
    await sprint.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("Complete the active sprint before starting another", 409);
    throw error;
  }
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "sprint:updated",
    { type: "started", sprint },
    "sprint.started",
    `started sprint “${sprint.name}”`
  );
  const [withProgress] = await sprintProgress(project, [sprint]);
  res.json({ sprint: withProgress });
});

const completeSprint = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.sprintId, "sprint id");
  const sprint = await Sprint.findOne({ _id: req.params.sprintId, project: project._id });
  if (!sprint) throw new AppError("Sprint not found", 404);
  if (sprint.status !== "active") throw new AppError("Only active sprints can be completed", 409);
  sprint.status = "completed";
  sprint.completedAt = new Date();
  await sprint.save();
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "sprint:updated",
    { type: "completed", sprint },
    "sprint.completed",
    `completed sprint “${sprint.name}”`
  );
  const [withProgress] = await sprintProgress(project, [sprint]);
  res.json({ sprint: withProgress });
});

const listMilestones = asyncHandler(async (req, res) => {
  const { project } = await loadProject(req);
  res.json({ milestones: project.projectMilestones });
});

const createMilestone = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  const dueDate = parseDate(req.body.dueDate);
  project.projectMilestones.push({
    title: req.body.title,
    description: req.body.description,
    dueDate: dueDate || undefined,
  });
  await project.save();
  const milestone = project.projectMilestones[project.projectMilestones.length - 1];
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "milestone:updated",
    { type: "created", milestone },
    "milestone.created",
    `created milestone “${milestone.title}”`
  );
  res.status(201).json({ milestone });
});

const updateMilestone = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.milestoneId, "milestone id");
  const milestone = project.projectMilestones.id(req.params.milestoneId);
  if (!milestone) throw new AppError("Milestone not found", 404);
  if (req.body.title !== undefined) milestone.title = req.body.title;
  if (req.body.description !== undefined) milestone.description = req.body.description;
  if (req.body.dueDate !== undefined) milestone.dueDate = parseDate(req.body.dueDate);
  if (req.body.progress !== undefined) {
    milestone.progress = req.body.progress;
    milestone.completedAt = req.body.progress === 100 ? (milestone.completedAt || new Date()) : undefined;
  }
  await project.save();
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "milestone:updated",
    { type: "updated", milestone },
    "milestone.updated",
    `updated milestone “${milestone.title}”`
  );
  res.json({ milestone });
});

const completeMilestone = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.milestoneId, "milestone id");
  const milestone = project.projectMilestones.id(req.params.milestoneId);
  if (!milestone) throw new AppError("Milestone not found", 404);
  milestone.progress = 100;
  milestone.completedAt = milestone.completedAt || new Date();
  await project.save();
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "milestone:updated",
    { type: "completed", milestone },
    "milestone.completed",
    `completed milestone “${milestone.title}”`
  );
  res.json({ milestone });
});

const removeMilestone = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireProjectPlanner(project, membership, req.user._id);
  assertObjectId(req.params.milestoneId, "milestone id");
  const milestone = project.projectMilestones.id(req.params.milestoneId);
  if (!milestone) throw new AppError("Milestone not found", 404);
  const title = milestone.title;
  milestone.deleteOne();
  await project.save();
  await recordPlanningUpdate(
    req,
    workspace,
    project,
    "milestone:updated",
    { type: "deleted", milestoneId: req.params.milestoneId },
    "milestone.deleted",
    `deleted milestone “${title}”`
  );
  res.json({ ok: true });
});

const removeTask = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  requireTaskWorkStage(project, membership, req.user._id);
  assertObjectId(req.params.taskId, "task id");
  const existing = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!existing) throw new AppError("Task not found", 404);
  const isCreator = String(existing.createdBy) === String(req.user._id);
  if (!isCreator && !canManageAssignedProject(project, membership, req.user._id)) {
    throw new AppError("Only the creator, assigned project manager, or workspace admin can delete this task", 403);
  }
  await Task.updateMany(
    { project: project._id, dependencies: existing._id },
    { $pull: { dependencies: existing._id } }
  );
  await existing.deleteOne();
  const io = req.app.get("io");
  emitToProjectWorkspace(io, workspace.members, project, "task:updated", {
    type: "deleted",
    projectId: String(project._id),
    taskId: String(existing._id),
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
    actor: req.user,
    action: "task.deleted",
    summary: `deleted “${existing.title}”`,
  });
  await notifyProjectStakeholders(io, workspace, project, req.user, `deleted task “${existing.title}”`);
  res.json({ ok: true });
});

const addComment = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  assertObjectId(req.params.taskId, "task id");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);
  const io = req.app.get("io");
  task.comments.push({ author: req.user._id, body: req.body.body });
  await task.save();
  await populateTask(task);
  emitToProjectWorkspace(io, workspace.members, project, "task:updated", {
    type: "updated",
    projectId: String(project._id),
    task,
  });
  await logActivity(io, {
    workspace: workspace._id,
    project: project._id,
    projectManager: project.projectManager,
    projectAssignments: project.departmentAssignments,
    workflowStage: project.workflowStage,
    workspaceMembers: workspace.members,
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
  const { project, workspace, membership } = await loadProject(req);
  requireWritableMember(membership);
  assertObjectId(req.params.taskId, "task id");
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) throw new AppError("Task not found", 404);
  const comment = task.comments.id(req.params.commentId);
  if (!comment) throw new AppError("Comment not found", 404);
  if (String(comment.author) !== String(req.user._id) && !canManageAssignedProject(project, membership, req.user._id)) {
    throw new AppError("You can only delete your own comments", 403);
  }
  comment.deleteOne();
  await task.save();
  await populateTask(task);
  emitToProjectWorkspace(req.app.get("io"), workspace.members, project, "task:updated", {
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
  const membership = workspace.members.find((member) => getMemberUserId(member) === String(req.user._id));
  const accessibleProjects = await findAccessibleProjects(workspace._id, membership, req.user._id);
  const taskQuery = {
    workspace: workspace._id,
    project: { $in: accessibleProjects.map((project) => project._id) },
    assignees: req.user._id,
  };
  const tasks = await Task.find(taskQuery)
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
  const projects = await findAccessibleProjects(workspace._id, membership, req.user._id);
  const projectIds = projects.map((project) => project._id);
  const [tasks, activity] = await Promise.all([
    Task.find({ project: { $in: projectIds } }).select("project columnId dueDate assignees priority"),
    Activity.find({
      workspace: workspace._id,
      project: { $in: projectIds },
    })
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
    workload: members.members.filter((m) => m.user).map((m) => ({
      user: m.user,
      role: m.role,
      ...(workload.get(String(m.user._id)) || { open: 0, done: 0, overdue: 0 }),
    })),
    activity,
    myRole: membership.role,
  });
});

const workspaceActivity = asyncHandler(async (req, res) => {
  const { workspace, membership } = await loadWorkspace(req.params.workspaceId, req.user._id);
  const projects = await findAccessibleProjects(workspace._id, membership, req.user._id);
  const query = {
    workspace: workspace._id,
    project: { $in: projects.map((project) => project._id) },
  };
  const items = await Activity.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("actor", "name avatarColor");
  res.json({ activity: items });
});

module.exports = {
  createSchema,
  projectUpdateSchema,
  projectTeamMembersSchema,
  workflowTransitionSchema,
  taskCreateSchema,
  taskUpdateSchema,
  taskReorderSchema,
  sprintCreateSchema,
  sprintUpdateSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  emptyBodySchema,
  commentSchema,
  list,
  create,
  getBoard,
  updateProject,
  addProjectTeamMembers,
  transitionWorkflow,
  removeProject,
  createTask,
  updateTask,
  reorderTasks,
  listSprints,
  createSprint,
  updateSprint,
  startSprint,
  completeSprint,
  listMilestones,
  createMilestone,
  updateMilestone,
  completeMilestone,
  removeMilestone,
  removeTask,
  addComment,
  removeComment,
  projectActivity,
  myTasks,
  dashboard,
  workspaceActivity,
};
