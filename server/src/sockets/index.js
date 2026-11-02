const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const { env } = require("../config/env");
const { COOKIE } = require("../utils/tokens");
const { memberOf } = require("../utils/access");

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

function attachSockets(io) {
  io.use(async (socket, next) => {
    try {
      const headerToken = socket.handshake.auth?.token;
      const cookies = parseCookie(socket.handshake.headers.cookie);
      const token = headerToken || cookies[COOKIE];
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error("User no longer exists"));
      if ((payload.ver || 0) !== user.tokenVersion) {
        return next(new Error("Session has ended"));
      }
      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.user;
    addSocket(user._id, socket.id);
    user.lastSeenAt = new Date();
    await user.save();

    const workspaces = await Workspace.find({ "members.user": user._id }).select("_id members");
    workspaces.forEach((ws) => socket.join(`workspace:${ws._id}`));

    const channels = await Channel.find({ members: user._id }).select("_id");
    channels.forEach((ch) => socket.join(`channel:${ch._id}`));

    socket.join(`user:${user._id}`);

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
        const channel = await Channel.findById(channelId);
        if (!channel) throw new Error("Channel not found");
        const workspace = await Workspace.findById(channel.workspace);
        if (!workspace || !memberOf(workspace, user._id)) throw new Error("Forbidden");
        if (!channel.members.some((id) => String(id) === String(user._id))) {
          throw new Error("Forbidden");
        }
        socket.join(`channel:${channel._id}`);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    socket.on("chat:typing", ({ channelId, typing }) => {
      if (!channelId) return;
      socket.to(`channel:${channelId}`).emit("chat:typing", {
        channelId,
        userId: String(user._id),
        name: user.name,
        typing: Boolean(typing),
      });
    });

    socket.on("disconnect", async () => {
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
  });
}

function emitToWorkspace(io, workspaceId, event, payload) {
  io.to(`workspace:${workspaceId}`).emit(event, payload);
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
  emitToChannel,
  emitToUser,
  isOnline,
  onlineIds,
};
