const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Session = require("../models/Session");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const Project = require("../models/Project");
const { env } = require("../config/env");
const { COOKIE } = require("../utils/tokens");
const { memberOf, getMemberUserId } = require("../utils/access");
const { canAccessProject } = require("../utils/access");
const { getMembership, loadTenantResource, enforcementMode } = require("../services/tenantAccess");
const { allRoomVariants } = require("../services/realtimeAccess");
const { configure, userRoom, sessionRoom, onlineIds, isOnline } = require("../services/realtimePresence");
const { emitToWorkspace, emitToProjectWorkspace, emitToChannel, emitToUser, emitToTyping, emitSocket, room, legacyRoom } = require("../services/realtimeEmit");

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

const AUTO_JOIN_ROOM_CAP = 100;
const JOIN_DENIED = Object.freeze({ ok: false, error: "Forbidden" });

function joinUser(userId, platformRole = null) {
  return { _id: userId, platformRole };
}

async function workspaceCanJoin(workspace, userId, platformRole) {
  const direct = memberOf(workspace, userId);
  if (direct) return direct;
  if (enforcementMode() !== "off" && workspace.organizationId) {
    const membership = await getMembership(userId, workspace.organizationId);
    return membership || platformRole === "super_admin";
  }
  return null;
}

async function canJoinResource(resource, scope, user) {
  if (scope === "workspace") return Boolean(await workspaceCanJoin(resource, user._id, user.platformRole));
  if (scope === "channel") {
    const workspace = resource.workspace?._id ? resource.workspace : await Workspace.findById(resource.workspace);
    const workspaceMembership = await workspaceCanJoin(workspace, user._id, user.platformRole);
    return Boolean(workspaceMembership && resource.members.some((id) => String(id) === String(user._id)));
  }
  if (scope === "project") {
    const workspace = resource.workspace?._id ? resource.workspace : await Workspace.findById(resource.workspace);
    const workspaceMembership = await workspaceCanJoin(workspace, user._id, user.platformRole);
    if (!workspaceMembership) return false;
    if (canAccessProject(resource, workspaceMembership, user._id)) return true;
    const organizationMembership = resource.workspace?.organizationId
      ? await getMembership(user._id, resource.workspace.organizationId)
      : null;
    return ["organization_admin", "organization_owner"].includes(organizationMembership?.role);
  }
  return false;
}

async function legacyCanJoinResource(resource, scope, user) {
  if (scope === "workspace") return Boolean(memberOf(resource, user._id));
  const workspace = resource.workspace?._id ? resource.workspace : await Workspace.findById(resource.workspace);
  const workspaceMembership = memberOf(workspace, user._id);
  if (!workspaceMembership) return false;
  if (scope === "channel") return resource.members.some((id) => String(id) === String(user._id));
  return canAccessProject(resource, workspaceMembership, user._id);
}

async function policyJoinAllowed(resource, scope, user, route) {
  const allowed = await canJoinResource(resource, scope, user);
  if (allowed || enforcementMode() !== "log") return allowed;
  console.warn(JSON.stringify({ route, userId: String(user._id), resourceId: String(resource._id), oldOutcome: "allowed", newOutcome: "denied", timestamp: new Date().toISOString() }));
  return legacyCanJoinResource(resource, scope, user);
}

async function joinChecked(socket, Model, id, user, scope, { enforceCap = false, capState = null } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new Error("Forbidden");
  const populate = scope === "channel" ? "workspace" : scope === "project" ? "workspace" : undefined;
  const resource = await loadTenantResource(Model, id, user, { populate, route: `socket.${scope}.join` });
  if (!await policyJoinAllowed(resource, scope, user, `socket.${scope}.join`)) throw new Error("Forbidden");
  const organizationId = resource.organizationId || resource.workspace?.organizationId || null;
  const rooms = allRoomVariants(scope, resource, organizationId);
  if (enforceCap && capState.count + rooms.length > AUTO_JOIN_ROOM_CAP) {
    console.warn(JSON.stringify({ event: "realtime.auto_join_cap", userId: String(user._id), cap: AUTO_JOIN_ROOM_CAP, resourceType: scope, resourceId: String(resource._id) }));
    return { resource, joined: false };
  }
  rooms.forEach((name) => socket.join(name));
  capState.count += rooms.length;
  const refreshed = await loadTenantResource(Model, id, user, { populate, route: `socket.${scope}.recheck` });
  if (!await policyJoinAllowed(refreshed, scope, user, `socket.${scope}.recheck`)) {
    rooms.forEach((name) => socket.leave(name));
    throw new Error("Forbidden");
  }
  return { resource, joined: true };
}

async function joinDenied(ack, operation) {
  try {
    await operation();
    if (typeof ack === "function") ack({ ok: true });
  } catch {
    if (typeof ack === "function") ack({ ...JOIN_DENIED });
  }
}

function attachSockets(io) {
  configure(io);
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie);
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        cookies[COOKIE];
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error("User no longer exists"));
      if ((payload.ver || 0) !== user.tokenVersion) {
        return next(new Error("Session has ended"));
      }
      let sessionRecordId = null;
      if (payload.sid) {
        const session = await Session.findOne({ user: user._id, sidHash: crypto.createHash("sha256").update(payload.sid).digest("hex") });
        if (!session) return next(new Error("Session has ended"));
        sessionRecordId = String(session._id);
        session.lastActivityAt = new Date();
        await session.save();
      }
      socket.data.userId = String(user._id);
      socket.data.tokenVersion = user.tokenVersion;
      socket.data.sessionId = payload.sid || null;
      socket.data.sessionRecordId = sessionRecordId;
      socket.data.authExpiresAt = payload.exp ? payload.exp * 1000 : null;
      next();
    } catch {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    let sessionExpiryTimer;
    let sessionValidationTimer;
    const enforceSessionExpiry = () => {
      const expiresAt = socket.data.authExpiresAt;
      if (!expiresAt) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        emitSocket(socket, "auth:session-expired");
        socket.disconnect(true);
        return;
      }
      sessionExpiryTimer = setTimeout(enforceSessionExpiry, Math.min(remaining, 2147483647));
    };
    socket.on("disconnect", async () => {
      clearTimeout(sessionExpiryTimer);
      clearInterval(sessionValidationTimer);
      const currentUser = await User.findById(userId).select("name");
      if (!(await isOnline(userId))) {
        await User.findByIdAndUpdate(userId, { lastSeenAt: new Date() });
        const workspaces = await Workspace.find({ "members.user": userId }).select("_id organizationId");
        workspaces.forEach((workspace) => emitToWorkspace(io, workspace, "presence:update", {
          userId: String(userId),
          online: false,
          name: currentUser?.name,
        }));
      }
    });
    const user = await User.findById(userId);
    if (!user) return socket.disconnect(true);
    enforceSessionExpiry();
    socket.join(userRoom(userId));
    if (socket.data.sessionId) socket.join(sessionRoom(socket.data.sessionId));
    if (socket.data.sessionRecordId) socket.join(sessionRoom(socket.data.sessionRecordId));
    user.lastSeenAt = new Date();
    await user.save();
    if (!socket.connected) return;

    const workspaces = await Workspace.find({ "members.user": userId }).select("_id organizationId members");
    if (!socket.connected) return;
    const capState = { count: 0 };
    for (const workspace of workspaces) {
      try {
        await joinChecked(socket, Workspace, workspace._id, joinUser(userId, user.platformRole), "workspace", { enforceCap: true, capState });
      } catch (error) {
        console.warn(JSON.stringify({ event: "realtime.auto_join_denied", userId: String(userId), resourceType: "workspace", resourceId: String(workspace._id), error: error.message }));
      }
    }

    const workspaceIds = workspaces.map((ws) => ws._id);
    const channels = await Channel.find({
      members: userId,
      workspace: { $in: workspaceIds },
    }).select("_id workspace");
    const projects = await Project.find({ workspace: { $in: workspaceIds } }).select("_id workspace");
    if (!socket.connected) return;
    const currentUser = await User.findById(userId).select("tokenVersion");
    if (!socket.connected) return;
    if (!currentUser || currentUser.tokenVersion !== socket.data.tokenVersion) {
      emitSocket(socket, "auth:session-expired");
      socket.disconnect(true);
      return;
    }
    for (const channel of channels) {
      try {
        await joinChecked(socket, Channel, channel._id, joinUser(userId, user.platformRole), "channel", { enforceCap: true, capState });
      } catch (error) {
        console.warn(JSON.stringify({ event: "realtime.auto_join_denied", userId: String(userId), resourceType: "channel", resourceId: String(channel._id), error: error.message }));
      }
    }
    for (const project of projects) {
      try {
        await joinChecked(socket, Project, project._id, joinUser(userId, user.platformRole), "project", { enforceCap: true, capState });
      } catch (error) {
        console.warn(JSON.stringify({ event: "realtime.auto_join_denied", userId: String(userId), resourceType: "project", resourceId: String(project._id), error: error.message }));
      }
    }

    workspaces.forEach((ws) => {
        emitToWorkspace(io, ws, "presence:update", {
          userId: String(userId),
        online: true,
        name: user.name,
      });
    });

    const visibleUserIds = new Set(workspaces.flatMap((workspace) => workspace.members.map(getMemberUserId)));
    emitSocket(socket, "presence:snapshot", { onlineUserIds: (await onlineIds()).filter((id) => visibleUserIds.has(String(id))) });

    sessionValidationTimer = setInterval(async () => {
      try {
        const currentUser = await User.findById(userId).select("tokenVersion");
        if (!currentUser || currentUser.tokenVersion !== socket.data.tokenVersion) {
          emitSocket(socket, "auth:session-expired");
          socket.disconnect(true);
          return;
        }
        if (socket.data.sessionId) {
          const session = await Session.findOne({ user: userId, sidHash: crypto.createHash("sha256").update(socket.data.sessionId).digest("hex") }).select("_id");
          if (!session) {
            emitSocket(socket, "auth:session-expired");
            socket.disconnect(true);
          }
        }
      } catch {
        // A transient database error should not disconnect a healthy socket.
      }
    }, 30000);

    socket.on("channel:join", (channelId, ack) => joinDenied(ack, () => joinChecked(socket, Channel, channelId, user, "channel")));
    socket.on("workspace:join", (workspaceId, ack) => joinDenied(ack, () => joinChecked(socket, Workspace, workspaceId, user, "workspace")));
    socket.on("project:join", (projectId, ack) => joinDenied(ack, () => joinChecked(socket, Project, projectId, user, "project")));

    socket.on("chat:typing", async ({ channelId, typing } = {}, ack) => {
      if (!channelId) {
        if (typeof ack === "function") ack({ ok: false, error: "Channel is required" });
        return;
      }
      try {
        const channel = await loadTenantResource(Channel, channelId, user, { populate: "workspace", route: "socket.chat.typing" });
        if (!await policyJoinAllowed(channel, "channel", user, "socket.chat.typing")) throw new Error("Forbidden");
        const workspace = channel.workspace;
        emitToTyping(io, { ...channel.toObject(), workspace }, {
          channelId: String(channel._id),
          userId: String(userId),
          name: user.name,
          typing: Boolean(typing),
        });
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("Socket typing authorization failed:", err.message);
        if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
      }
    });

  });
}

module.exports = {
  attachSockets,
  emitToWorkspace,
  emitToProjectWorkspace,
  emitToChannel,
  emitToUser,
  isOnline,
  onlineIds,
};
