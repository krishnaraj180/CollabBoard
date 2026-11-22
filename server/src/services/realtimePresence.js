let activeIo = null;

function configure(io) {
  activeIo = io;
}

function userRoom(userId) {
  return `user:${String(userId)}`;
}

function sessionRoom(sessionId) {
  return `session:${String(sessionId)}`;
}

async function isOnline(userId) {
  if (!activeIo) return false;
  const sockets = await activeIo.in(userRoom(userId)).fetchSockets();
  return sockets.length > 0;
}

async function onlineIds() {
  if (!activeIo) return [];
  const sockets = await activeIo.fetchSockets();
  return [...new Set(sockets.map((socket) => String(socket.data.userId)).filter(Boolean))];
}

module.exports = { configure, userRoom, sessionRoom, isOnline, onlineIds };
