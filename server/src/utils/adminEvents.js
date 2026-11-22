function recordAdminEvent({ organizationId, actorId, targetUserId, action, role }) {
  console.info(JSON.stringify({
    event: "admin.role_change",
    organizationId: organizationId ? String(organizationId) : null,
    actorId: actorId ? String(actorId) : null,
    targetUserId: targetUserId ? String(targetUserId) : null,
    action,
    role: role || null,
    timestamp: new Date().toISOString(),
  }));
}

module.exports = { recordAdminEvent };
