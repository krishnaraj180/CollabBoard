const Notification = require("../models/Notification");
const { asyncHandler } = require("../utils/errors");

const list = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.unread === "true") filter.read = false;
  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 40), 100));
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ notifications, unreadCount });
});

const markRead = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  await Notification.updateMany({ user: req.user._id, read: false, ...(ids?.length ? { _id: { $in: ids } } : {}) }, { $set: { read: true } });
  res.json({ ok: true });
});

module.exports = { list, markRead };
