const { connectDb, disconnectDb } = require("../config/db");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const Organization = require("../models/Organization");
const Project = require("../models/Project");

function id(value) {
  return value ? String(value._id || value) : null;
}

function compare(result, child, parent) {
  result.total += 1;
  if (!child && parent) result.childNullParentSet += 1;
  else if (child && !parent) result.childSetParentNull += 1;
  else if (child && parent && child !== parent) result.bothSetDifferent += 1;
}

function newCollectionResult() {
  return {
    total: 0,
    childNullParentSet: 0,
    bothSetDifferent: 0,
    childSetParentNull: 0,
    brokenParent: 0,
    parentUnknown: 0,
  };
}

async function main() {
  await connectDb();
  const report = {
    collections: {
      Channel: newCollectionResult(),
      Message: newCollectionResult(),
      Activity: newCollectionResult(),
      Notification: newCollectionResult(),
    },
    attachments: { checked: false, reason: "Attachments are embedded in Message and are not queried independently." },
  };

  const workspaces = new Map();
  const workspaceRows = await require("../models/Workspace").find({}).select("organizationId").lean();
  workspaceRows.forEach((workspace) => workspaces.set(id(workspace), id(workspace.organizationId)));

  const channels = await Channel.find({}).select("organizationId workspace").lean();
  const channelOrgs = new Map();
  for (const channel of channels) {
    const parent = workspaces.get(id(channel.workspace));
    if (parent === undefined) report.collections.Channel.brokenParent += 1;
    else compare(report.collections.Channel, id(channel.organizationId), parent);
    channelOrgs.set(id(channel), parent === undefined ? null : parent);
  }

  const messages = await Message.find({}).select("organizationId workspace channel").lean();
  for (const message of messages) {
    const parent = channelOrgs.has(id(message.channel))
      ? channelOrgs.get(id(message.channel))
      : workspaces.get(id(message.workspace));
    if (parent === undefined) report.collections.Message.brokenParent += 1;
    else compare(report.collections.Message, id(message.organizationId), parent);
  }

  const activities = await Activity.find({}).select("organizationId workspace").lean();
  for (const activity of activities) {
    const parent = workspaces.get(id(activity.workspace));
    if (parent === undefined) report.collections.Activity.brokenParent += 1;
    else compare(report.collections.Activity, id(activity.organizationId), parent);
  }

  const [organizations, projects] = await Promise.all([
    Organization.find({}).select("_id").lean(),
    Project.find({}).select("_id").populate("workspace", "organizationId").lean(),
  ]);
  const organizationIds = new Set(organizations.map(id));
  const projectOrgs = new Map(projects.map((project) => [id(project), id(project.workspace?.organizationId)]));
  const notifications = await Notification.find({}).select("organizationId meta").lean();
  for (const notification of notifications) {
    const meta = notification.meta || {};
    let parent;
    if (!meta.resourceType) {
      compare(report.collections.Notification, id(notification.organizationId), null);
      continue;
    }
    if (meta.resourceType === "Organization") parent = organizationIds.has(id(meta.resourceId)) ? id(meta.resourceId) : undefined;
    else if (meta.resourceType === "Project") parent = projectOrgs.get(id(meta.resourceId));
    else if (meta.resourceType === "Workspace") parent = workspaces.get(id(meta.resourceId));
    else if (meta.resourceType === "Channel") parent = channelOrgs.get(id(meta.resourceId));
    else report.collections.Notification.parentUnknown += 1;
    if (parent === undefined) report.collections.Notification.brokenParent += 1;
    else compare(report.collections.Notification, id(notification.organizationId), parent);
  }

  console.log(JSON.stringify(report, null, 2));
  const mismatches = Object.values(report.collections).some((collection) =>
    collection.bothSetDifferent > 0 || collection.childSetParentNull > 0 || collection.brokenParent > 0 || collection.parentUnknown > 0
  );
  if (mismatches) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Tenant consistency check failed:", error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
