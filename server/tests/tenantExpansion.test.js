const mongoose = require("mongoose");
const Workspace = require("../src/models/Workspace");
const Project = require("../src/models/Project");
const Channel = require("../src/models/Channel");
const Message = require("../src/models/Message");
const Activity = require("../src/models/Activity");
const Notification = require("../src/models/Notification");
const { resolveTenantFromParent } = require("../src/utils/organizationAccess");
const { logActivity } = require("../src/utils/activity");
const { notifyUsers } = require("../src/utils/notify");
const chat = require("../src/controllers/chatController");
const projects = require("../src/controllers/projectController");
const workspaces = require("../src/controllers/workspaceController");

describe("tenant expand writes", () => {
  const orgOne = new mongoose.Types.ObjectId();
  const orgTwo = new mongoose.Types.ObjectId();
  const userOne = new mongoose.Types.ObjectId();

  test("resolves loaded workspace, project, and channel parents and preserves legacy null", () => {
    const linkedWorkspace = new Workspace({ organizationId: orgOne, name: "Linked", members: [] });
    const legacyWorkspace = new Workspace({ name: "Legacy", members: [] });
    const project = new Project({ workspace: linkedWorkspace, name: "Project", createdBy: userOne });
    const channel = new Channel({ workspace: linkedWorkspace, members: [userOne], createdBy: userOne });

    expect(String(resolveTenantFromParent(linkedWorkspace))).toBe(String(orgOne));
    expect(String(resolveTenantFromParent(project))).toBe(String(orgOne));
    expect(String(resolveTenantFromParent(channel))).toBe(String(orgOne));
    expect(resolveTenantFromParent(legacyWorkspace)).toBeNull();
    expect(() => resolveTenantFromParent({})).toThrow(TypeError);
  });

  test("stores activity tenant from the loaded workspace, including legacy null", async () => {
    const createSpy = jest.spyOn(Activity, "create").mockImplementation(async (value) => ({
      ...value,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
    }));
    const linkedWorkspace = new Workspace({ organizationId: orgOne, name: "Linked", members: [] });
    const legacyWorkspace = new Workspace({ name: "Legacy", members: [] });
    const actor = { _id: userOne, name: "User", avatarColor: "#fff" };

    await logActivity(null, { workspace: linkedWorkspace._id, tenantParent: linkedWorkspace, actor, action: "test", summary: "linked" });
    await logActivity(null, { workspace: legacyWorkspace._id, tenantParent: legacyWorkspace, actor, action: "test", summary: "legacy" });

    expect(createSpy.mock.calls[0][0].organizationId.toString()).toBe(orgOne.toString());
    expect(createSpy.mock.calls[1][0].organizationId).toBeNull();
    createSpy.mockRestore();
  });

  test("keeps notifications scoped to the event resource for a user in two organizations", async () => {
    const insertSpy = jest.spyOn(Notification, "insertMany").mockResolvedValue([]);
    const workspaceOne = new Workspace({ organizationId: orgOne, name: "One", members: [] });
    const workspaceTwo = new Workspace({ organizationId: orgTwo, name: "Two", members: [] });

    await notifyUsers(null, [userOne], { resource: workspaceOne, type: "project.update", title: "One" });
    await notifyUsers(null, [userOne], { resource: workspaceTwo, type: "project.update", title: "Two" });

    expect(insertSpy.mock.calls[0][0][0].organizationId.toString()).toBe(orgOne.toString());
    expect(insertSpy.mock.calls[1][0][0].organizationId.toString()).toBe(orgTwo.toString());
    insertSpy.mockRestore();
  });

  test("keeps account-level notifications unscoped", async () => {
    const insertSpy = jest.spyOn(Notification, "insertMany").mockResolvedValue([]);
    await notifyUsers(null, [userOne], { type: "account.security", title: "Password changed" });
    expect(insertSpy.mock.calls[0][0][0].organizationId).toBeNull();
    insertSpy.mockRestore();
  });

  test("rejects protected fields while stripping unrelated unknown client fields", () => {
    const cases = [
      [chat.channelSchema, { params: { workspaceId: "workspace" }, body: { name: "General", organizationId: "attacker", extra: "ignored" } }],
      [workspaces.createSchema, { body: { name: "Workspace", ownerId: "attacker", extra: "ignored" } }],
      [projects.createSchema, { params: { workspaceId: "workspace" }, body: { name: "Project", createdBy: "attacker", extra: "ignored" } }],
      [projects.taskCreateSchema, { params: { id: "project" }, body: { title: "Task", members: [], extra: "ignored" } }],
    ];
    for (const [schema, value] of cases) expect(() => schema.parse(value)).toThrow();
    expect(chat.channelSchema.parse({ params: { workspaceId: "workspace" }, body: { name: "General", extra: "ignored" } }).body)
      .not.toHaveProperty("extra");
  });

  test("tenant fields are nullable and indexed on the expanded records", () => {
    for (const model of [Channel, Message, Activity, Notification]) {
      expect(model.schema.path("organizationId").options.default).toBeNull();
      expect(model.schema.indexes().some(([keys]) => keys.organizationId === 1)).toBe(true);
    }
    expect(Message.schema.path("attachments.organizationId")).toBeUndefined();
  });
});
