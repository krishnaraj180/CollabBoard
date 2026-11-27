function recordAdminEvent({ organizationId, actorId, targetUserId, action, role, roleId, permissionDiff }) {
  console.info(JSON.stringify({
    event: "admin.role_change",
    organizationId: organizationId ? String(organizationId) : null,
    actorId: actorId ? String(actorId) : null,
    targetUserId: targetUserId ? String(targetUserId) : null,
    action,
    role: role || null,
    roleId: roleId ? String(roleId) : null,
    permissionDiff: permissionDiff ? {
      added: permissionDiff.added || [],
      removed: permissionDiff.removed || [],
    } : null,
    timestamp: new Date().toISOString(),
  }));
}

module.exports = { recordAdminEvent };
