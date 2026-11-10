const { AppError } = require("./errors");

const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  CEO: "ceo",
  MANAGING_DIRECTOR: "managing_director",
  CTO: "cto",
  PROJECT_MANAGER: "project_manager",
  ENGINEERING_MANAGER: "engineering_manager",
  TEAM_LEAD: "team_lead",
  DEVELOPMENT_TEAM_LEAD: "development_team_lead",
  FRONTEND_DEVELOPER: "frontend_developer",
  REACT_DEVELOPER: "react_developer",
  UI_DEVELOPER: "ui_developer",
  BACKEND_DEVELOPER: "backend_developer",
  NODEJS_DEVELOPER: "nodejs_developer",
  JAVA_DEVELOPER: "java_developer",
  PYTHON_DEVELOPER: "python_developer",
  QA_MANAGER: "qa_manager",
  QA_TEAM_LEAD: "qa_team_lead",
  QA_ENGINEER: "qa_engineer",
  DESIGN_MANAGER: "design_manager",
  DESIGN_TEAM_LEAD: "design_team_lead",
  UI_UX_DESIGNER: "ui_ux_designer",
  HR_MANAGER: "hr_manager",
  HR_EXECUTIVE: "hr_executive",
  RECRUITER: "recruiter",
  HR_EMPLOYEE: "hr_employee",
  DEVOPS_MANAGER: "devops_manager",
  DEVOPS_TEAM_LEAD: "devops_team_lead",
  DEVOPS_ENGINEER: "devops_engineer",
  FINANCE_MANAGER: "finance_manager",
  ACCOUNTANT: "accountant",
  FINANCE_EXECUTIVE: "finance_executive",
  MARKETING_MANAGER: "marketing_manager",
  MARKETING_TEAM_LEAD: "marketing_team_lead",
  MARKETING_EXECUTIVE: "marketing_executive",
  MARKETING: "marketing",
  FINANCE: "finance",
  MEMBER: "member",
  VIEWER: "viewer",
};

const WORKSPACE_ROLES = Object.values(ROLES);
const ASSIGNABLE_WORKSPACE_ROLES = WORKSPACE_ROLES.filter((role) => role !== ROLES.OWNER);
const MANAGER_ROLES = [ROLES.OWNER, ROLES.ADMIN];
const PROJECT_TEAM_ROLES = [
  ROLES.ENGINEERING_MANAGER,
  ROLES.TEAM_LEAD,
  ROLES.DEVELOPMENT_TEAM_LEAD,
  ROLES.FRONTEND_DEVELOPER,
  ROLES.REACT_DEVELOPER,
  ROLES.UI_DEVELOPER,
  ROLES.BACKEND_DEVELOPER,
  ROLES.NODEJS_DEVELOPER,
  ROLES.JAVA_DEVELOPER,
  ROLES.PYTHON_DEVELOPER,
  ROLES.QA_MANAGER,
  ROLES.QA_TEAM_LEAD,
  ROLES.QA_ENGINEER,
  ROLES.DESIGN_MANAGER,
  ROLES.DESIGN_TEAM_LEAD,
  ROLES.UI_UX_DESIGNER,
  ROLES.HR_MANAGER,
  ROLES.HR_EXECUTIVE,
  ROLES.RECRUITER,
  ROLES.HR_EMPLOYEE,
  ROLES.DEVOPS_MANAGER,
  ROLES.DEVOPS_TEAM_LEAD,
  ROLES.DEVOPS_ENGINEER,
  ROLES.FINANCE_MANAGER,
  ROLES.ACCOUNTANT,
  ROLES.FINANCE_EXECUTIVE,
  ROLES.MARKETING_MANAGER,
  ROLES.MARKETING_TEAM_LEAD,
  ROLES.MARKETING_EXECUTIVE,
  ROLES.MARKETING,
  ROLES.FINANCE,
];
const WORKFLOW_REVIEW_ROLES = {
  business_approval: [ROLES.MANAGING_DIRECTOR],
  technical_review: [ROLES.CTO],
  executive_review: [ROLES.CEO, ROLES.MANAGING_DIRECTOR],
};

/**
 * Granular Permission Matrix
 * Maps individual actions to the minimum roles permitted to perform them.
 */
const PERMISSIONS = {
  // Workspace management
  "workspace:update": [ROLES.OWNER, ROLES.ADMIN],
  "workspace:delete": [ROLES.OWNER],
  "member:invite": [ROLES.OWNER, ROLES.ADMIN],
  "member:remove": [ROLES.OWNER, ROLES.ADMIN],
  "member:role": [ROLES.OWNER],

  // Project management
  "project:create": [ROLES.OWNER, ROLES.ADMIN],
  "project:update": [ROLES.OWNER, ROLES.ADMIN],
  "project:delete": [ROLES.OWNER, ROLES.ADMIN],

  // Task management
  "task:create": [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER],
  "task:update": [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER],
  "task:move": [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER],
  "task:delete": [ROLES.OWNER, ROLES.ADMIN], // or creator handled in controller
  "task:comment": [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER],

  // Channel management
  "channel:create": [ROLES.OWNER, ROLES.ADMIN],
  "channel:message": [ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER],
};

function getMemberUserId(m) {
  if (!m || !m.user) return null;
  return m.user._id ? String(m.user._id) : String(m.user);
}

function memberOf(workspace, userId) {
  if (!workspace || !workspace.members) return null;
  const uid = String(userId);
  return workspace.members.find((m) => getMemberUserId(m) === uid);
}

function requireMember(workspace, userId) {
  const membership = memberOf(workspace, userId);
  if (!membership) throw new AppError("You do not have access to this workspace", 403);
  return membership;
}

function requireRole(workspace, userId, roles) {
  const membership = requireMember(workspace, userId);
  if (!roles.includes(membership.role)) {
    throw new AppError("Insufficient workspace permissions", 403);
  }
  return membership;
}

function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission];
  return allowed ? allowed.includes(role) : false;
}

function requirePermission(workspace, userId, permission) {
  const membership = requireMember(workspace, userId);
  if (!hasPermission(membership.role, permission)) {
    throw new AppError(`Insufficient permissions: cannot perform "${permission}"`, 403);
  }
  return membership;
}

function canManageMembers(role) {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}

function isManager(role) {
  return MANAGER_ROLES.includes(role);
}

function canAccessProject(project, membership, userId) {
  if (!project || !membership) return false;
  if (isManager(membership.role)) return true;

  const id = String(userId);
  if (membership.role === ROLES.PROJECT_MANAGER &&
      String(project.projectManager?._id || project.projectManager || "") === id) {
    return true;
  }
  if (PROJECT_TEAM_ROLES.includes(membership.role) &&
      (project.departmentAssignments || []).some((assignment) =>
        String(assignment.teamLead?._id || assignment.teamLead) === id ||
        (assignment.members || []).some((member) => String(member?._id || member) === id)
      )) {
    return true;
  }
  return (WORKFLOW_REVIEW_ROLES[project.workflowStage] || []).includes(membership.role);
}

module.exports = {
  ROLES,
  WORKSPACE_ROLES,
  ASSIGNABLE_WORKSPACE_ROLES,
  MANAGER_ROLES,
  PROJECT_TEAM_ROLES,
  canAccessProject,
  PERMISSIONS,
  memberOf,
  requireMember,
  requireRole,
  requirePermission,
  hasPermission,
  canManageMembers,
  isManager,
  getMemberUserId,
};
