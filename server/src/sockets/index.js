const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Session = require("../models/Session");
const crypto = require("crypto");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const { env } = require("../config/env");
const { COOKIE } = require("../utils/tokens");
const { memberOf, getMemberUserId } = require("../utils/access");
const { configure, userRoom, sessionRoom, onlineIds, isOnline } = require("./realtimeAccess");
const { emitToWorkspace, emitToProjectWorkspace, emitToChannel, emitToUser, emitToTyping, emitSocket, room, legacyRoom } = require("./realtimeEmit");

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

async function findAuthorizedChannel(channelId, userId) {
  const channel = await Channel.findById(channelId);
  if (!channel) return null;
  const workspace = await Workspace.findById(channel.workspace).select("members");
  if (!workspace || !memberOf(workspace, userId)) return null;
  if (!channel.members.some((id) => String(id) === String(userId))) return null;
  return channel;
}

function attachSockets(io) {
  configure(io);
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie);
      const token = cookies[COOKIE];
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error("User no longer exists"));
      if ((payload.ver || 0) !== user.tokenVersion) {
        return next(new Error("Session has ended"));
      }
      if (payload.sid) {
        const session = await Session.findOne({ user: user._id, sidHash: crypto.createHash("sha256").update(payload.sid).digest("hex") });
        if (!session) return next(new Error("Session has ended"));
        session.lastActivityAt = new Date();
        await session.save();
      }
      socket.data.userId = String(user._id);
      socket.data.tokenVersion = user.tokenVersion;
      socket.data.sessionId = payload.sid || null;
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
    user.lastSeenAt = new Date();
    await user.save();
    if (!socket.connected) return;

    const workspaces = await Workspace.find({ "members.user": userId }).select("_id organizationId members");
    if (!socket.connected) return;
    workspaces.forEach((workspace) => {
      socket.join(room("workspace", workspace._id, workspace.organizationId));
      if (env.tenantEnforcement === "off") socket.join(legacyRoom("workspace", workspace._id));
    });

    const workspaceIds = workspaces.map((ws) => ws._id);
    const channels = await Channel.find({
      members: userId,
      workspace: { $in: workspaceIds },
    }).select("_id workspace");
    if (!socket.connected) return;
    const currentUser = await User.findById(userId).select("tokenVersion");
    if (!socket.connected) return;
    if (!currentUser || currentUser.tokenVersion !== socket.data.tokenVersion) {
      emitSocket(socket, "auth:session-expired");
      socket.disconnect(true);
      return;
    }
    channels.forEach((channel) => {
      const workspace = workspaces.find((item) => String(item._id) === String(channel.workspace));
      socket.join(room("channel", channel._id, workspace?.organizationId));
      if (env.tenantEnforcement === "off") socket.join(legacyRoom("channel", channel._id));
    });

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

    socket.on("channel:join", async (channelId, ack) => {
      try {
        const channel = await findAuthorizedChannel(channelId, userId);
        if (!channel) throw new Error("Forbidden");
        const workspace = await Workspace.findById(channel.workspace).select("organizationId");
        socket.join(room("channel", channel._id, workspace?.organizationId));
        if (env.tenantEnforcement === "off") socket.join(legacyRoom("channel", channel._id));
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    socket.on("chat:typing", async ({ channelId, typing } = {}, ack) => {
      if (!channelId) {
        if (typeof ack === "function") ack({ ok: false, error: "Channel is required" });
        return;
      }
      try {
        const channel = await findAuthorizedChannel(channelId, userId);
        if (!channel) {
          if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
          return;
        }
        const workspace = await Workspace.findById(channel.workspace).select("organizationId");
        emitToTyping(io, { ...channel.toObject(), workspace }, {
          channelId: String(channel._id),
          userId: String(userId),
          name: user.name,
          typing: Boolean(typing),
        });
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("Socket typing authorization failed:", err.message);
        if (typeof ack === "function") ack({ ok: false, error: "Unable to authorize channel" });
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
