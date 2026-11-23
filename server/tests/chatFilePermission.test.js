const mongoose = require("mongoose");
const Role = require("../src/models/Role");
const Workspace = require("../src/models/Workspace");
const Channel = require("../src/models/Channel");
const Message = require("../src/models/Message");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const Organization = require("../src/models/Organization");
const { requirePermission } = require("../src/services/tenantAccess");
const { findTenantMessageForFile } = require("../src/controllers/fileController");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

test("custom channel permissions allow only the requested action", async () => {
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const role = await Role.create({ organizationId, name: "Chat Member", key: "chat_member", permissions: ["channel:message"] });
  await OrganizationMembership.create({ organizationId, userId, role: "member", roleId: role._id, status: "active" });
  const workspace = await Workspace.create({ organizationId, name: "Chat workspace", members: [{ user: userId, role: "member" }] });
  const channel = await Channel.create({ organizationId, workspace: workspace._id, name: "Private", members: [userId], createdBy: userId });
  await channel.populate("workspace");
  await expect(requirePermission("channel:message", channel, { _id: userId })).resolves.toBeDefined();
  await expect(requirePermission("channel:create", workspace, { _id: userId })).rejects.toMatchObject({ status: 403 });
});

test("legacy channel access remains membership and legacy-role based", async () => {
  const userId = new mongoose.Types.ObjectId();
  const workspace = await Workspace.create({ name: "Legacy chat", members: [{ user: userId, role: "member" }] });
  const channel = await Channel.create({ workspace: workspace._id, name: "General", members: [userId], createdBy: userId });
  await channel.populate("workspace");
  await expect(requirePermission("channel:message", channel, { _id: userId })).resolves.toBeDefined();
});

test("file lookup is tenant-filtered and foreign attachments look nonexistent", async () => {
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  await Organization.create([
    { _id: orgA, name: "Org A", createdBy: userA, ownerId: userA, members: [{ user: userA, role: "organization_admin" }] },
    { _id: orgB, name: "Org B", createdBy: userB, ownerId: userB, members: [{ user: userB, role: "organization_admin" }] },
  ]);
  await OrganizationMembership.create([
    { organizationId: orgA, userId: userA, role: "member", status: "active" },
    { organizationId: orgB, userId: userB, role: "member", status: "active" },
  ]);
  const workspaceA = await Workspace.create({ organizationId: orgA, name: "A", members: [{ user: userA, role: "member" }] });
  const workspaceB = await Workspace.create({ organizationId: orgB, name: "B", members: [{ user: userB, role: "member" }] });
  const channelA = await Channel.create({ organizationId: orgA, workspace: workspaceA._id, name: "A", members: [userA], createdBy: userA });
  const channelB = await Channel.create({ organizationId: orgB, workspace: workspaceB._id, name: "B", members: [userB], createdBy: userB });
  await Message.create({ organizationId: orgA, workspace: workspaceA._id, channel: channelA._id, sender: userA, body: "file", attachments: [{ filename: "tenant-a.txt" }] });
  expect(await findTenantMessageForFile("tenant-a.txt", userA)).toBeTruthy();
  expect(await findTenantMessageForFile("tenant-a.txt", userB)).toBeNull();
  expect(await findTenantMessageForFile("missing.txt", userB)).toBeNull();
  expect(channelB).toBeTruthy();
});

test("a user in two organizations gets independent channel permissions", async () => {
  const userId = new mongoose.Types.ObjectId();
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const roleA = await Role.create({ organizationId: orgA, name: "Messenger", key: "messenger", permissions: ["channel:message"] });
  const roleB = await Role.create({ organizationId: orgB, name: "Reader", key: "reader", permissions: ["organization:read"] });
  await OrganizationMembership.create([
    { organizationId: orgA, userId, role: "member", roleId: roleA._id, status: "active" },
    { organizationId: orgB, userId, role: "member", roleId: roleB._id, status: "active" },
  ]);
  const workspaceA = await Workspace.create({ organizationId: orgA, name: "A", members: [{ user: userId, role: "member" }] });
  const workspaceB = await Workspace.create({ organizationId: orgB, name: "B", members: [{ user: userId, role: "member" }] });
  const channelA = await Channel.create({ organizationId: orgA, workspace: workspaceA._id, name: "A", members: [userId], createdBy: userId });
  const channelB = await Channel.create({ organizationId: orgB, workspace: workspaceB._id, name: "B", members: [userId], createdBy: userId });
  await channelA.populate("workspace");
  await channelB.populate("workspace");
  await expect(requirePermission("channel:message", channelA, { _id: userId })).resolves.toBeDefined();
  await expect(requirePermission("channel:message", channelB, { _id: userId })).rejects.toMatchObject({ status: 403 });
});
