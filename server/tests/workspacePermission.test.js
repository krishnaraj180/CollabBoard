const mongoose = require("mongoose");
const Workspace = require("../src/models/Workspace");
const Role = require("../src/models/Role");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { requirePermission } = require("../src/services/tenantAccess");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

test("a custom role with workspace:update works only in its organization", async () => {
  const userId = new mongoose.Types.ObjectId();
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const customA = await Role.create({ organizationId: orgA, name: "Workspace Editor", key: "workspace_editor", permissions: ["workspace:update"] });
  const customB = await Role.create({ organizationId: orgB, name: "Read Only", key: "read_only", permissions: ["organization:read"] });
  await OrganizationMembership.create({ organizationId: orgA, userId, role: "viewer", roleId: customA._id, status: "active" });
  await OrganizationMembership.create({ organizationId: orgB, userId, role: "viewer", roleId: customB._id, status: "active" });
  const workspaceA = await Workspace.create({ organizationId: orgA, name: "A", members: [{ user: userId, role: "viewer" }] });
  const workspaceB = await Workspace.create({ organizationId: orgB, name: "B", members: [{ user: userId, role: "viewer" }] });
  await expect(requirePermission("workspace:update", workspaceA, { _id: userId })).resolves.toBeDefined();
  await expect(requirePermission("workspace:update", workspaceB, { _id: userId })).rejects.toMatchObject({ status: 403 });
});

test("legacy workspace permission checks remain role-based", async () => {
  const userId = new mongoose.Types.ObjectId();
  const workspace = await Workspace.create({ name: "Legacy", members: [{ user: userId, role: "admin" }] });
  await expect(requirePermission("workspace:update", workspace, { _id: userId })).resolves.toBeDefined();
});
