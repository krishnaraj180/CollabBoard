const Notification = require("../models/Notification");
const { asyncHandler } = require("../utils/errors");

const list = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(40);
  res.json({ notifications });
});

const markRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  res.json({ ok: true });
});

module.exports = { list, markRead };
