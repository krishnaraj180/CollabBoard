const { AppError } = require("./errors");

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

function organizationMemberOf(organization, userId) {
  return organization?.members?.find((member) => String(member.user?._id || member.user) === String(userId)) || null;
}

function hasOrganizationPermission(user, membership, permission) {
  if (user?.platformRole === "super_admin") return true;
  const allowed = ORGANIZATION_PERMISSIONS[permission];
  return Boolean(membership && allowed?.includes(membership.role));
}

function canAccessOrganizationProject(project, membership, userId, platformRole = null) {
  if (!membership) return platformRole === "super_admin";
  if (["super_admin", "organization_admin", "viewer"].includes(membership.role) || platformRole === "super_admin") return true;
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

function requireOrganizationPermission(organization, user, permission) {
  const membership = organizationMemberOf(organization, user._id);
  if (!membership && user.platformRole !== "super_admin") {
    throw new AppError("You do not have access to this organization", 403);
  }
  if (!hasOrganizationPermission(user, membership, permission)) {
    throw new AppError(`Insufficient organization permissions: cannot perform "${permission}"`, 403);
  }
  return membership;
}

module.exports = {
  ORGANIZATION_PERMISSIONS,
  organizationMemberOf,
  hasOrganizationPermission,
  canAccessOrganizationProject,
  requireOrganizationPermission,
};
