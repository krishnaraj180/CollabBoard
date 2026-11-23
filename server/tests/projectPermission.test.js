const mongoose = require("mongoose");
const Role = require("../src/models/Role");
const Workspace = require("../src/models/Workspace");
const Project = require("../src/models/Project");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { requirePermission } = require("../src/services/tenantAccess");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

test.each([
  ["project:create", "create"],
  ["project:update", "update"],
  ["project:delete", "delete"],
])("a custom role with %s is accepted for project %s", async (permission) => {
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const role = await Role.create({ organizationId, name: `Project ${permission}`, key: permission.replace(/[:]/g, "_"), permissions: [permission] });
  await OrganizationMembership.create({ organizationId, userId, role: "member", roleId: role._id, status: "active" });
  const workspace = await Workspace.create({ organizationId, name: "Tenant workspace", members: [{ user: userId, role: "member" }] });
  const project = await Project.create({ workspace: workspace._id, name: "Tenant project", createdBy: userId, owner: userId });
  await project.populate("workspace");
  await expect(requirePermission(permission, project, { _id: userId })).resolves.toBeDefined();
});

test("a custom role without project:update is denied and legacy workspaces remain role-based", async () => {
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const role = await Role.create({ organizationId, name: "Project Reader", key: "project_reader", permissions: ["organization:read"] });
  await OrganizationMembership.create({ organizationId, userId, role: "member", roleId: role._id, status: "active" });
  const workspace = await Workspace.create({ organizationId, name: "Tenant workspace", members: [{ user: userId, role: "member" }] });
  const project = await Project.create({ workspace: workspace._id, name: "Tenant project", createdBy: userId, owner: userId });
  await project.populate("workspace");
  await expect(requirePermission("project:update", project, { _id: userId })).rejects.toMatchObject({ status: 403 });

  const legacyWorkspace = await Workspace.create({ name: "Legacy workspace", members: [{ user: userId, role: "admin" }] });
  const legacyProject = await Project.create({ workspace: legacyWorkspace._id, name: "Legacy project", createdBy: userId, owner: userId });
  await legacyProject.populate("workspace");
  await expect(requirePermission("project:update", legacyProject, { _id: userId })).resolves.toBeDefined();
});

test("the same user receives independent project permissions in two organizations", async () => {
  const userId = new mongoose.Types.ObjectId();
  const organizationA = new mongoose.Types.ObjectId();
  const organizationB = new mongoose.Types.ObjectId();
  const roleA = await Role.create({ organizationId: organizationA, name: "Project Editor", key: "project_editor", permissions: ["project:update"] });
  const roleB = await Role.create({ organizationId: organizationB, name: "Project Viewer", key: "project_viewer", permissions: ["organization:read"] });
  await OrganizationMembership.create({ organizationId: organizationA, userId, role: "member", roleId: roleA._id, status: "active" });
  await OrganizationMembership.create({ organizationId: organizationB, userId, role: "member", roleId: roleB._id, status: "active" });
  const workspaceA = await Workspace.create({ organizationId: organizationA, name: "A", members: [{ user: userId, role: "member" }] });
  const workspaceB = await Workspace.create({ organizationId: organizationB, name: "B", members: [{ user: userId, role: "member" }] });
  const projectA = await Project.create({ workspace: workspaceA._id, name: "A project", createdBy: userId, owner: userId });
  const projectB = await Project.create({ workspace: workspaceB._id, name: "B project", createdBy: userId, owner: userId });
  await projectA.populate("workspace");
  await projectB.populate("workspace");
  await expect(requirePermission("project:update", projectA, { _id: userId })).resolves.toBeDefined();
  await expect(requirePermission("project:update", projectB, { _id: userId })).rejects.toMatchObject({ status: 403 });
});
