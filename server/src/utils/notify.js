const Notification = require("../models/Notification");
const { emitToUser } = require("../sockets");
const { resolveTenantFromParent } = require("./organizationAccess");

async function notifyUsers(io, userIds, payload) {
  const unique = [...new Set(userIds.map(String))].filter(Boolean);
  const organizationId = payload.resource ? resolveTenantFromParent(payload.resource) : null;
  const resourceType = payload.resource?.constructor?.modelName || null;
  const resourceId = payload.resource?._id || null;
  const docs = await Notification.insertMany(
    unique.map((user) => ({
      organizationId,
      user,
      type: payload.type,
      title: payload.title,
      body: payload.body || "",
      link: payload.link || "",
      meta: {
        ...(payload.meta || {}),
        ...(payload.resource ? { resourceType, resourceId } : {}),
      },
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
