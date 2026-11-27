const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const { buildReport, hasMismatches } = require("./verifyTenantConsistency");

async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri("collabboard-consistency"));
    const organizationId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const workspace = await Workspace.create({ organizationId, name: "Seeded workspace", members: [{ user: userId, role: "owner" }] });
    const channel = await Channel.create({ organizationId, workspace: workspace._id, name: "general", members: [userId], createdBy: userId });
    const message = await Message.create({ organizationId, workspace: workspace._id, channel: channel._id, sender: userId, body: "seed" });
    await Organization.create({ _id: organizationId, name: "Seeded organization", createdBy: userId, ownerId: userId, members: [{ user: userId, role: "organization_admin" }] });
    await Activity.create({ organizationId, workspace: workspace._id, actor: userId, action: "seed", summary: "seed" });
    await Notification.create({ organizationId, user: userId, type: "seed", title: "seed", body: "seed", meta: { resourceType: "Channel", resourceId: channel._id } });
    if (!message) throw new Error("Seed message was not created");
    const report = await buildReport();
    console.log(JSON.stringify(report, null, 2));
    if (hasMismatches(report)) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error("Seeded tenant consistency check failed:", error.message);
  process.exitCode = 1;
});
