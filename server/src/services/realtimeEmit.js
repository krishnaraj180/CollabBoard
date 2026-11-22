const { enforcementMode } = require("../services/tenantAccess");
const { userRoom } = require("./realtimePresence");
const { canAccessProject } = require("../utils/access");

function resourceId(resource) {
  return resource?._id || resource;
}

function workspaceOf(resource, explicitWorkspace) {
  return explicitWorkspace || resource?._tenantWorkspace || (resource?.workspace && typeof resource.workspace === "object" ? resource.workspace : null);
}

function organizationOf(resource, explicitOrganizationId) {
  if (explicitOrganizationId !== undefined) return explicitOrganizationId || null;
  if (resource?.organizationId !== undefined) return resource.organizationId || null;
  const workspace = workspaceOf(resource);
  return workspace?.organizationId || null;
}

function room(scope, id, organizationId) {
  return organizationId ? `org:${organizationId}:${scope}:${id}` : `legacy:${scope}:${id}`;
}

function legacyRoom(scope, id) {
  return `${scope}:${id}`;
}

function emitSocket(socket, event, payload) {
  socket.emit(event, payload);
}

function emitRoom(io, rooms, event, payload) {
  const uniqueRooms = [...new Set(rooms.filter(Boolean))];
  if (!uniqueRooms.length) return;
  io.to(uniqueRooms).emit(event, payload);
}

function emitToWorkspace(io, workspace, event, payload, { organizationId } = {}) {
  const id = resourceId(workspace);
  const orgId = organizationOf(workspace, organizationId);
  const scoped = room("workspace", id, orgId);
  const legacy = legacyRoom("workspace", id);
  emitRoom(io, enforcementMode() === "off" ? [scoped, legacy] : [scoped], event, payload);
}

function emitToChannel(io, channel, event, payload, { organizationId } = {}) {
  const id = resourceId(channel);
  const orgId = organizationOf(channel, organizationId);
  const scoped = room("channel", id, orgId);
  const legacy = legacyRoom("channel", id);
  emitRoom(io, enforcementMode() === "off" ? [scoped, legacy] : [scoped], event, payload);
}

function emitToProjectWorkspace(io, members, project, event, payload, { workspace, organizationId } = {}) {
  const projectId = resourceId(project);
  const parentWorkspace = workspaceOf(project, workspace);
  const orgId = organizationOf(project, organizationId || parentWorkspace?.organizationId);
  const projectRoom = room("project", projectId, orgId);
  const workspaceId = resourceId(parentWorkspace);
  const legacyWorkspace = workspaceId ? legacyRoom("workspace", workspaceId) : null;
  if (projectRoom) io.to(projectRoom).emit(event, payload);
  if (enforcementMode() !== "off" || !legacyWorkspace) return;

  const allowed = new Set(
    (members || []).filter((member) => {
      const userId = member.user?._id || member.user || member;
      return canAccessProject(project, member, userId);
    }).map((member) => String(member.user?._id || member.user || member))
  );
  const excluded = (members || [])
    .map((member) => String(member.user?._id || member.user || member))
    .filter((id) => !allowed.has(id))
    .map(userRoom);
  const target = excluded.reduce((builder, excludedRoom) => builder.except(excludedRoom), io.to(legacyWorkspace));
  target.emit(event, payload);
}

function emitToUser(io, userId, event, payload) {
  io.in(userRoom(userId)).emit(event, payload);
}

function emitToTyping(io, channel, payload, { organizationId } = {}) {
  const id = resourceId(channel);
  const orgId = organizationOf(channel, organizationId);
  const scoped = room("channel", id, orgId);
  const legacy = legacyRoom("channel", id);
  const rooms = enforcementMode() === "off" ? [scoped, legacy] : [scoped];
  io.to(rooms).emit("chat:typing", payload);
}

module.exports = { emitToWorkspace, emitToChannel, emitToProjectWorkspace, emitToUser, emitToTyping, emitSocket, room, legacyRoom };
