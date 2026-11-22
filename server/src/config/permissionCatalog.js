const PERMISSIONS = Object.freeze([
  "organization:read",
  "organization:update",
  "organization:invite",
  "organization:members",
  "organization:departments",
  "organization:workspaces",
  "organization:reports",
  "organization:proposals",
  "workspace:update",
  "workspace:organization_update",
  "workspace:delete",
  "member:invite",
  "member:remove",
  "member:role",
  "project:create",
  "project:update",
  "project:delete",
  "task:create",
  "task:update",
  "task:move",
  "task:delete",
  "task:comment",
  "channel:create",
  "channel:message",
]);

const PERMISSION_SET = new Set(PERMISSIONS);

function isKnownPermission(permission) {
  return typeof permission === "string" && PERMISSION_SET.has(permission);
}

function assertKnownPermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.some((permission) => !isKnownPermission(permission))) {
    const unknown = (permissions || []).filter((permission) => !isKnownPermission(permission));
    throw new TypeError(`Unknown permission string(s): ${unknown.join(", ")}`);
  }
  return permissions;
}

module.exports = { PERMISSIONS, isKnownPermission, assertKnownPermissions };
