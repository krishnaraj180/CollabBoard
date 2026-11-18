const Workspace = require("../models/Workspace");
const Organization = require("../models/Organization");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const Project = require("../models/Project");

async function boundedTenantGaps(limit = 1000) {
  const gaps = {};
  const linkedWorkspaceIds = (await Workspace.find({ organizationId: { $ne: null } }).select("_id").limit(limit).lean()).map((row) => row._id);
  const [channels, messages, activities] = await Promise.all([
    Channel.aggregate([
      { $match: { organizationId: null, workspace: { $in: linkedWorkspaceIds } } },
      { $limit: limit },
      { $count: "count" },
    ]),
    Message.aggregate([
      { $match: { organizationId: null } },
      { $lookup: { from: "workspaces", localField: "workspace", foreignField: "_id", as: "workspace" } },
      { $match: { "workspace.organizationId": { $ne: null } } },
      { $limit: limit },
      { $count: "count" },
    ]),
    Activity.aggregate([
      { $match: { organizationId: null } },
      { $lookup: { from: "workspaces", localField: "workspace", foreignField: "_id", as: "workspace" } },
      { $match: { "workspace.organizationId": { $ne: null } } },
      { $limit: limit },
      { $count: "count" },
    ]),
  ]);
  gaps.Channel = channels[0]?.count || 0;
  gaps.Message = messages[0]?.count || 0;
  gaps.Activity = activities[0]?.count || 0;
  const notifications = await Notification.find({ organizationId: null, "meta.resourceType": { $in: ["Organization", "Workspace", "Project", "Channel"] } })
    .select("meta.resourceType meta.resourceId")
    .limit(limit)
    .lean();
  let notificationGaps = 0;
  for (const notification of notifications) {
    const resourceId = notification.meta?.resourceId;
    const type = notification.meta?.resourceType;
    if (!resourceId) continue;
    let parent = null;
    if (type === "Organization") parent = await Organization.findOne({ _id: resourceId, status: { $exists: true } }).select("_id").lean();
    if (type === "Workspace") parent = await Workspace.findOne({ _id: resourceId, organizationId: { $ne: null } }).select("_id").lean();
    if (type === "Project") parent = await Project.findOne({ _id: resourceId }).populate("workspace", "organizationId");
    if (type === "Channel") parent = await Channel.findOne({ _id: resourceId, organizationId: { $ne: null } }).select("_id").lean();
    if (parent && (type === "Organization" || parent.organizationId || parent.workspace?.organizationId)) notificationGaps += 1;
  }
  gaps.Notification = Math.min(notificationGaps, limit);
  return gaps;
}

async function assertTenantReady({ override = false, logger = console } = {}) {
  const gaps = await boundedTenantGaps();
  const total = Object.values(gaps).reduce((sum, count) => sum + count, 0);
  if (!total) return gaps;
  if (override) {
    logger.error(JSON.stringify({ event: "tenant.enforcement_override", gaps, timestamp: new Date().toISOString() }));
    return gaps;
  }
  throw new Error(`TENANT_ENFORCEMENT=on refused: ${total} non-legacy records have null organizationId`);
}

module.exports = { boundedTenantGaps, assertTenantReady };
