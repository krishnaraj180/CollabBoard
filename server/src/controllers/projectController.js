const { z } = require("zod");
const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
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

const removeProject = asyncHandler(async (req, res) => {
  const { project, workspace, membership } = await loadProject(req);
  requireManager(membership);
  const io = req.app.get("io");
  await Task.deleteMany({ project: project._id });
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
  workflowTransitionSchema,
  taskCreateSchema,
  taskUpdateSchema,
  commentSchema,
  list,
  create,
  getBoard,
  updateProject,
  transitionWorkflow,
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
