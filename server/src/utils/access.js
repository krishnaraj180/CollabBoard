const { AppError } = require("./errors");

const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
};

const MANAGER_ROLES = [ROLES.OWNER, ROLES.ADMIN];

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

module.exports = {
  ROLES,
  MANAGER_ROLES,
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
