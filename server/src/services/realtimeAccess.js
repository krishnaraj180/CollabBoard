const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const Project = require("../models/Project");
const { enforcementMode } = require("./tenantAccess");
const { room, legacyRoom } = require("./realtimeEmit");
const { userRoom, sessionRoom } = require("./realtimePresence");

function allRoomVariants(scope, resource, organizationId) {
  const id = String(resource?._id || resource);
  const scoped = room(scope, id, organizationId || null);
  const rooms = [scoped];
  if (enforcementMode() !== "on") rooms.push(legacyRoom(scope, id));
  if (scope === "workspace") rooms.push(`workspace:${id}`);
  if (scope === "channel") rooms.push(`channel:${id}`);
  if (scope === "project" && resource?.workspace?._id && enforcementMode() !== "on") {
    rooms.push(room("workspace", resource.workspace._id, organizationId || null));
    rooms.push(legacyRoom("workspace", resource.workspace._id));
  }
  return rooms;
}

async function roomsForWorkspace(workspace) {
  const organizationId = workspace.organizationId || null;
  const rooms = allRoomVariants("workspace", workspace, organizationId);
  const [channels, projects] = await Promise.all([
    Channel.find({ workspace: workspace._id }).select("_id").lean(),
    Project.find({ workspace: workspace._id }).select("_id").lean(),
  ]);
  channels.forEach((channel) => rooms.push(...allRoomVariants("channel", channel, organizationId)));
  projects.forEach((project) => rooms.push(...allRoomVariants("project", project, organizationId)));
  return [...new Set(rooms)];
}

async function roomsForOrganization(organizationId) {
  const workspaces = await Workspace.find({ organizationId }).select("_id organizationId").lean();
  const roomLists = await Promise.all(workspaces.map(roomsForWorkspace));
  return [...new Set(roomLists.flat())];
}

/** Evict one user's sockets from the supplied tenant/resource rooms. */
async function revokeUser(io, organizationId, userId, rooms = []) {
  try {
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    const prefix = organizationId ? `org:${String(organizationId)}:` : null;
    for (const socket of sockets) {
      const targets = [...new Set([
        ...rooms,
        ...[...socket.rooms].filter((name) => prefix && name.startsWith(prefix)),
      ])];
      if (targets.length) await io.in(socket.id).socketsLeave(targets);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "realtime.revoke_user_failed", organizationId: organizationId ? String(organizationId) : null, userId: String(userId), error: error.message }));
  }
}

/** Evict every socket currently joined to an organization's scoped rooms. */
async function revokeOrganization(io, organizationId) {
  try {
    const prefix = `org:${String(organizationId)}:`;
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      if ([...socket.rooms].some((name) => name.startsWith(prefix))) {
        await io.in(socket.id).disconnectSockets(true);
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "realtime.revoke_organization_failed", organizationId: String(organizationId), error: error.message }));
  }
}

/** Join a user's live sockets to server-derived tenant/resource rooms. */
async function grantUser(io, organizationId, userId, rooms = []) {
  try {
    if (!organizationId && !rooms.length) return;
    const targetRooms = rooms.length ? rooms : await roomsForOrganization(organizationId);
    if (targetRooms.length) await io.in(userRoom(userId)).socketsJoin([...new Set(targetRooms)]);
  } catch (error) {
    console.error(JSON.stringify({ event: "realtime.grant_user_failed", organizationId: String(organizationId), userId: String(userId), error: error.message }));
  }
}

/** Disconnect only sockets authenticated with one revoked session id. */
async function revokeSession(io, sessionId) {
  try {
    if (sessionId) await io.in(sessionRoom(sessionId)).disconnectSockets(true);
  } catch (error) {
    console.error(JSON.stringify({ event: "realtime.revoke_session_failed", sessionId: String(sessionId), error: error.message }));
  }
}

module.exports = { revokeUser, revokeOrganization, revokeSession, grantUser, roomsForWorkspace, roomsForOrganization, allRoomVariants };
