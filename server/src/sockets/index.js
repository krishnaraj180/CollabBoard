const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Session = require("../models/Session");
const crypto = require("crypto");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const { env } = require("../config/env");
const { COOKIE } = require("../utils/tokens");
const { memberOf, getMemberUserId, canAccessProject } = require("../utils/access");

const socketsByUser = new Map();

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

function addSocket(userId, socketId) {
  const key = String(userId);
  if (!socketsByUser.has(key)) socketsByUser.set(key, new Set());
  socketsByUser.get(key).add(socketId);
}

function removeSocket(userId, socketId) {
  const key = String(userId);
  const set = socketsByUser.get(key);
  if (!set) return 0;
  set.delete(socketId);
  if (set.size === 0) socketsByUser.delete(key);
  return set.size;
}

function isOnline(userId) {
  return socketsByUser.has(String(userId));
}

function onlineIds() {
  return [...socketsByUser.keys()];
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
      socket.user = user;
      socket.data.authExpiresAt = payload.exp ? payload.exp * 1000 : null;
      next();
    } catch {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.user;
    let workspaces = [];
    let sessionExpiryTimer;
    const enforceSessionExpiry = () => {
      const expiresAt = socket.data.authExpiresAt;
      if (!expiresAt) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        socket.emit("auth:session-expired");
        socket.disconnect(true);
        return;
      }
      sessionExpiryTimer = setTimeout(enforceSessionExpiry, Math.min(remaining, 2147483647));
    };
    socket.on("disconnect", async () => {
      clearTimeout(sessionExpiryTimer);
      const remaining = removeSocket(user._id, socket.id);
      if (remaining === 0) {
        await User.findByIdAndUpdate(user._id, { lastSeenAt: new Date() });
        workspaces.forEach((ws) => {
          io.to(`workspace:${ws._id}`).emit("presence:update", {
            userId: String(user._id),
            online: false,
            name: user.name,
          });
        });
      }
    });
    addSocket(user._id, socket.id);
    enforceSessionExpiry();
    socket.join(`user:${user._id}`);
    user.lastSeenAt = new Date();
    await user.save();
    if (!socket.connected) return;

    workspaces = await Workspace.find({ "members.user": user._id }).select("_id members");
    if (!socket.connected) return;
    workspaces.forEach((ws) => socket.join(`workspace:${ws._id}`));

    const workspaceIds = workspaces.map((ws) => ws._id);
    const channels = await Channel.find({
      members: user._id,
      workspace: { $in: workspaceIds },
    }).select("_id");
    if (!socket.connected) return;
    const currentUser = await User.findById(user._id).select("tokenVersion");
    if (!socket.connected) return;
    if (!currentUser || currentUser.tokenVersion !== user.tokenVersion) {
      socket.emit("auth:session-expired");
      socket.disconnect(true);
      return;
    }
    channels.forEach((ch) => socket.join(`channel:${ch._id}`));

    workspaces.forEach((ws) => {
      io.to(`workspace:${ws._id}`).emit("presence:update", {
        userId: String(user._id),
        online: true,
        name: user.name,
      });
    });

    socket.emit("presence:snapshot", { onlineUserIds: onlineIds() });

    socket.on("channel:join", async (channelId, ack) => {
      try {
        const channel = await findAuthorizedChannel(channelId, user._id);
        if (!channel) throw new Error("Forbidden");
        socket.join(`channel:${channel._id}`);
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
        const channel = await findAuthorizedChannel(channelId, user._id);
        if (!channel) {
          if (typeof ack === "function") ack({ ok: false, error: "Forbidden" });
          return;
        }
        socket.to(`channel:${channel._id}`).emit("chat:typing", {
          channelId: String(channel._id),
          userId: String(user._id),
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

function emitToWorkspace(io, workspaceId, event, payload) {
  io.to(`workspace:${workspaceId}`).emit(event, payload);
}

function emitToProjectWorkspace(io, members, project, event, payload) {
  members.forEach((member) => {
    const userId = getMemberUserId(member);
    if (!canAccessProject(project, member, userId)) return;
    emitToUser(io, userId, event, payload);
  });
}

function emitToChannel(io, channelId, event, payload) {
  io.to(`channel:${channelId}`).emit(event, payload);
}

function emitToUser(io, userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload);
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
