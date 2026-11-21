const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");
const Organization = require("../src/models/Organization");
const Workspace = require("../src/models/Workspace");
const Project = require("../src/models/Project");
const Channel = require("../src/models/Channel");
const Message = require("../src/models/Message");
const Activity = require("../src/models/Activity");
const Notification = require("../src/models/Notification");
const { startDb, stopDb } = require("./helpers");
const { migrate, rollback, assertProductionSafety } = require("../src/scripts/migrateTenantFoundation");

let tempDir;

async function runMigration(options = {}) {
  return migrate({
    dbName: "collabboard-migration-test",
    batchSize: 2,
    checkpointFile: path.join(tempDir, "checkpoint.json"),
    reportFile: path.join(tempDir, `${options.apply ? "apply" : "dry"}.json`),
    undoFile: path.join(tempDir, "undo.json"),
    ...options,
  });
}

beforeAll(async () => {
  await startDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collabboard-migration-"));
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await stopDb();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seedRecords() {
  const user = new mongoose.Types.ObjectId();
  const organization = await Organization.create({ name: "Acme", createdBy: user, ownerId: user, members: [{ user, role: "organization_admin" }] });
  const linkedWorkspace = await Workspace.create({ name: "Linked", organizationId: organization._id, members: [] });
  const legacyWorkspace = await Workspace.create({ name: "Legacy", members: [] });
  const linkedProject = await Project.create({ workspace: linkedWorkspace._id, name: "Linked project", createdBy: user });
  const legacyProject = await Project.create({ workspace: legacyWorkspace._id, name: "Legacy project", createdBy: user });
  const linkedChannel = await Channel.create({ workspace: linkedWorkspace._id, members: [user], createdBy: user });
  const legacyChannel = await Channel.create({ workspace: legacyWorkspace._id, members: [user], createdBy: user });
  const linkedMessage = await Message.create({ workspace: linkedWorkspace._id, channel: linkedChannel._id, sender: user, body: "linked" });
  const legacyMessage = await Message.create({ workspace: legacyWorkspace._id, channel: legacyChannel._id, sender: user, body: "legacy" });
  const linkedActivity = await Activity.create({ workspace: linkedWorkspace._id, project: linkedProject._id, actor: user, action: "test", summary: "linked" });
  const legacyActivity = await Activity.create({ workspace: legacyWorkspace._id, project: legacyProject._id, actor: user, action: "test", summary: "legacy" });
  const linkedNotification = await Notification.create({ user, type: "project.update", title: "linked", meta: { resourceType: "Workspace", resourceId: linkedWorkspace._id } });
  return { organization, linkedWorkspace, legacyWorkspace, linkedChannel, legacyChannel, linkedMessage, legacyMessage, linkedActivity, legacyActivity, linkedNotification };
}

describe("tenant backfill migration", () => {
  test("dry-run changes nothing and apply is idempotent", async () => {
    const seeded = await seedRecords();
    const before = await Channel.findById(seeded.linkedChannel._id).lean();
    const dry = await runMigration();
    expect(dry.report.mode).toBe("dry-run");
    expect((await Channel.findById(seeded.linkedChannel._id)).organizationId).toBeNull();
    const applied = await runMigration({ apply: true });
    expect(applied.report.collections.Channel.updated).toBe(1);
    expect(String((await Channel.findById(seeded.linkedChannel._id)).organizationId)).toBe(String(seeded.organization._id));
    expect((await Channel.findById(seeded.legacyChannel._id)).organizationId).toBeNull();
    const second = await runMigration({ apply: true, checkpointFile: path.join(tempDir, "second-checkpoint.json"), reportFile: path.join(tempDir, "second.json") });
    expect(second.report.collections.Channel.updated).toBe(0);
    expect((await Channel.findById(seeded.linkedChannel._id)).toObject()).toEqual(expect.objectContaining({ organizationId: seeded.organization._id }));
    expect(before.organizationId).toBeNull();
  });

  test("backfills every child type, reports mismatch/orphan, and rollback unsets only migration values", async () => {
    const seeded = await seedRecords();
    const wrongOrg = new mongoose.Types.ObjectId();
    const mismatch = await Channel.create({ workspace: seeded.linkedWorkspace._id, organizationId: wrongOrg, members: [], createdBy: new mongoose.Types.ObjectId() });
    const orphan = await Channel.create({ workspace: new mongoose.Types.ObjectId(), members: [], createdBy: new mongoose.Types.ObjectId() });
    const result = await runMigration({ apply: true });
    expect(result.report.collections.Message.updated).toBe(1);
    expect(result.report.collections.Activity.updated).toBe(1);
    expect(result.report.collections.Notification.updated).toBe(1);
    expect(result.report.mismatches.some((entry) => entry.id === String(mismatch._id))).toBe(true);
    expect(result.report.brokenLinks.some((entry) => entry.id === String(orphan._id))).toBe(true);
    expect(String((await Message.findById(seeded.linkedMessage._id)).organizationId)).toBe(String(seeded.organization._id));
    expect((await Message.findById(seeded.legacyMessage._id)).organizationId).toBeNull();
    await rollback(result.undoFile);
    expect((await Message.findById(seeded.linkedMessage._id)).organizationId).toBeNull();
    expect((await Channel.findById(mismatch._id)).organizationId.toString()).toBe(wrongOrg.toString());
  });

  test("production requires both explicit confirmation values", () => {
    expect(() => assertProductionSafety({ confirmProduction: false }, "mongodb://db.example/collabboard", "production")).toThrow();
    process.env.MIGRATION_CONFIRM_DB = "collabboard";
    expect(() => assertProductionSafety({ confirmProduction: true }, "mongodb://db.example/collabboard", "production")).not.toThrow();
    delete process.env.MIGRATION_CONFIRM_DB;
  });

  test("applies only an explicit legacy workspace mapping", async () => {
    const seeded = await seedRecords();
    const mappingFile = path.join(tempDir, "mapping.json");
    fs.writeFileSync(mappingFile, JSON.stringify({ [seeded.legacyWorkspace._id]: seeded.organization._id }));
    const result = await runMigration({ apply: true, mappingFile, checkpointFile: path.join(tempDir, "mapping-checkpoint.json") });
    expect(result.report.legacyWorkspaces.find((item) => item.id === String(seeded.legacyWorkspace._id)).mapped).toBe(true);
    expect(String((await Workspace.findById(seeded.legacyWorkspace._id)).organizationId)).toBe(String(seeded.organization._id));
    expect(String((await Channel.findById(seeded.legacyChannel._id)).organizationId)).toBe(String(seeded.organization._id));
  });

  test("resumes after a failed batch using the saved checkpoint", async () => {
    const seeded = await seedRecords();
    const ChannelModel = require("../src/models/Channel");
    const bulkSpy = jest.spyOn(ChannelModel, "bulkWrite").mockRejectedValueOnce(new Error("simulated interruption"));
    await expect(runMigration({ apply: true, checkpointFile: path.join(tempDir, "resume-checkpoint.json") })).rejects.toThrow("simulated interruption");
    bulkSpy.mockRestore();
    const resumed = await runMigration({ apply: true, checkpointFile: path.join(tempDir, "resume-checkpoint.json"), reportFile: path.join(tempDir, "resumed.json") });
    expect(resumed.report.collections.Channel.updated).toBe(1);
    expect(String((await Channel.findById(seeded.linkedChannel._id)).organizationId)).toBe(String(seeded.organization._id));
  });
});
