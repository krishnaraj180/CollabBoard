const Notification = require("../models/Notification");
const { emitToUser } = require("../sockets");

async function notifyUsers(io, userIds, payload) {
  const unique = [...new Set(userIds.map(String))].filter(Boolean);
  const docs = await Notification.insertMany(
    unique.map((user) => ({
      user,
      type: payload.type,
      title: payload.title,
      body: payload.body || "",
      link: payload.link || "",
      meta: payload.meta || {},
    }))
  );
  if (!io) return docs;
  docs.forEach((doc) => {
    emitToUser(io, doc.user, "notification:new", {
      id: doc._id,
      type: doc.type,
      title: doc.title,
      body: doc.body,
      link: doc.link,
      read: false,
      createdAt: doc.createdAt,
    });
  });
  return docs;
}

module.exports = { notifyUsers };
