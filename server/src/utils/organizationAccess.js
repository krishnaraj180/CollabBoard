const { AppError } = require("./errors");
const { getMembership } = require("../services/tenantAccess");

function modelName(parent) {
  return parent?.constructor?.modelName || parent?.$__?.model?.constructor?.modelName || null;
}

function resolveTenantFromParent(parent) {
  const type = modelName(parent);
  if (!["Organization", "Workspace", "Project", "Channel"].includes(type)) {
    throw new TypeError("Tenant parent must be a loaded Workspace, Project, or Channel document");
  }
  if (type === "Organization") return parent._id;
  if (type === "Workspace") return parent.organizationId || null;
  const workspace = parent.workspace;
  if (!workspace || modelName(workspace) !== "Workspace") {
    throw new TypeError(`${type} tenant resolution requires a populated workspace parent`);
  }
  return workspace.organizationId || null;
}

const ORGANIZATION_PERMISSIONS = {
  "organization:read": ["organization_admin", "business_management", "project_manager", "team_lead", "developer", "qa_tester", "viewer"],
  "organization:update": ["organization_admin"],
  "organization:invite": ["organization_admin"],
  "organization:members": ["organization_admin"],
  "organization:departments": ["organization_admin"],
  "organization:workspaces": ["organization_admin"],
  "organization:reports": ["organization_admin", "project_manager", "team_lead", "viewer"],
  "organization:proposals": ["organization_admin", "business_management"],
};

async function organizationMemberOf(organization, userId) {
  if (!organization?._id) return null;
  return getMembership(userId, organization._id);
}

function hasOrganizationPermission(user, membership, permission) {
  if (user?.platformRole === "super_admin") return true;
  const allowed = ORGANIZATION_PERMISSIONS[permission];
  return Boolean(membership && (membership.role === "organization_owner" || allowed?.includes(membership.role)));
}

function canAccessOrganizationProject(project, membership, userId, platformRole = null) {
  if (!membership) return platformRole === "super_admin";
  if (["super_admin", "organization_owner", "organization_admin", "viewer"].includes(membership.role) || platformRole === "super_admin") return true;
  const id = String(userId);
  if (membership.role === "project_manager" &&
      String(project.projectManager?._id || project.projectManager || "") === id) return true;
  if (!membership.department) return false;
  return (project.departmentAssignments || []).some((assignment) =>
    assignment.department === membership.department &&
    (String(assignment.teamLead?._id || assignment.teamLead) === id ||
      (assignment.members || []).some((member) => String(member?._id || member) === id))
  );
}

async function requireOrganizationPermission(organization, user, permission) {
  const membership = await organizationMemberOf(organization, user._id);
  if (!membership && user.platformRole !== "super_admin") {
    throw new AppError("You do not have access to this organization", 404);
  }
  if (!hasOrganizationPermission(user, membership, permission)) {
    throw new AppError(`Insufficient organization permissions: cannot perform "${permission}"`, 403);
  }
  return membership;
}

module.exports = {
  ORGANIZATION_PERMISSIONS,
  resolveTenantFromParent,
  organizationMemberOf,
  hasOrganizationPermission,
  canAccessOrganizationProject,
  requireOrganizationPermission,
};
