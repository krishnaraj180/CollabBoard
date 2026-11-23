const mongoose = require("mongoose");
const Role = require("../src/models/Role");
const Workspace = require("../src/models/Workspace");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { requirePermission } = require("../src/services/tenantAccess");
const { assertAssigneesInWorkspace, validateTaskDependencies } = require("../src/controllers/projectController");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

test.each([
  ["task:create", "create"],
  ["task:update", "update"],
  ["task:move", "move"],
  ["task:comment", "comment"],
])("a custom role with %s is accepted for task %s", async (permission) => {
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const role = await Role.create({ organizationId, name: `Task ${permission}`, key: permission.replace(/[:]/g, "_"), permissions: [permission] });
  await OrganizationMembership.create({ organizationId, userId, role: "member", roleId: role._id, status: "active" });
  const workspace = await Workspace.create({ organizationId, name: "Task workspace", members: [{ user: userId, role: "member" }] });
  const project = await Project.create({ workspace: workspace._id, name: "Task project", createdBy: userId, owner: userId });
  await project.populate("workspace");
  await expect(requirePermission(permission, project, { _id: userId })).resolves.toBeDefined();
});

test("a custom role without task:update is denied and legacy workspaces remain role-based", async () => {
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const role = await Role.create({ organizationId, name: "Task Reader", key: "task_reader", permissions: ["organization:read"] });
  await OrganizationMembership.create({ organizationId, userId, role: "member", roleId: role._id, status: "active" });
  const workspace = await Workspace.create({ organizationId, name: "Task workspace", members: [{ user: userId, role: "member" }] });
  const project = await Project.create({ workspace: workspace._id, name: "Task project", createdBy: userId, owner: userId });
  await project.populate("workspace");
  await expect(requirePermission("task:update", project, { _id: userId })).rejects.toMatchObject({ status: 403 });

  const legacyWorkspace = await Workspace.create({ name: "Legacy task workspace", members: [{ user: userId, role: "member" }] });
  const legacyProject = await Project.create({ workspace: legacyWorkspace._id, name: "Legacy project", createdBy: userId, owner: userId });
  await legacyProject.populate("workspace");
  await expect(requirePermission("task:update", legacyProject, { _id: userId })).resolves.toBeDefined();
});

test("assignees and dependencies must belong to the current workspace and project", async () => {
  const userId = new mongoose.Types.ObjectId();
  const foreignUserId = new mongoose.Types.ObjectId();
  const workspace = await Workspace.create({ name: "Workspace", members: [{ user: userId, role: "member" }] });
  expect(() => assertAssigneesInWorkspace(workspace, [foreignUserId])).toThrow(/workspace/);
  const project = await Project.create({ workspace: workspace._id, name: "Project", createdBy: userId, owner: userId });
  const foreignProject = await Project.create({ workspace: workspace._id, name: "Foreign project", createdBy: userId, owner: userId });
  const foreignTask = await Task.create({ workspace: workspace._id, project: foreignProject._id, title: "Foreign task", createdBy: userId });
  await expect(validateTaskDependencies(project._id, null, [foreignTask._id])).rejects.toMatchObject({ status: 400 });
});

test("the same user receives independent task permissions in two organizations", async () => {
  const userId = new mongoose.Types.ObjectId();
  const organizationA = new mongoose.Types.ObjectId();
  const organizationB = new mongoose.Types.ObjectId();
  const roleA = await Role.create({ organizationId: organizationA, name: "Task Editor", key: "task_editor", permissions: ["task:update"] });
  const roleB = await Role.create({ organizationId: organizationB, name: "Task Reader", key: "task_reader", permissions: ["organization:read"] });
  await OrganizationMembership.create({ organizationId: organizationA, userId, role: "member", roleId: roleA._id, status: "active" });
  await OrganizationMembership.create({ organizationId: organizationB, userId, role: "member", roleId: roleB._id, status: "active" });
  const workspaceA = await Workspace.create({ organizationId: organizationA, name: "A", members: [{ user: userId, role: "member" }] });
  const workspaceB = await Workspace.create({ organizationId: organizationB, name: "B", members: [{ user: userId, role: "member" }] });
  const projectA = await Project.create({ workspace: workspaceA._id, name: "A project", createdBy: userId, owner: userId });
  const projectB = await Project.create({ workspace: workspaceB._id, name: "B project", createdBy: userId, owner: userId });
  await projectA.populate("workspace");
  await projectB.populate("workspace");
  await expect(requirePermission("task:update", projectA, { _id: userId })).resolves.toBeDefined();
  await expect(requirePermission("task:update", projectB, { _id: userId })).rejects.toMatchObject({ status: 403 });
});
