const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { env } = require("../config/env");
const { connectDb, disconnectDb } = require("../config/db");
const Organization = require("../models/Organization");
const OrganizationMembership = require("../models/OrganizationMembership");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const { resolveTenantFromParent } = require("../utils/organizationAccess");

const COLLECTIONS = ["Workspace", "Project", "Channel", "Message", "Activity", "Notification"];
const MODELS = { Workspace, Project, Channel, Message, Activity, Notification };
const DEFAULT_BATCH_SIZE = 500;
const REPORT_DIR = path.resolve(__dirname, "../../migration-reports");

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, confirmProduction: false, mapping: null, checkpoint: null, report: null, batchSize: DEFAULT_BATCH_SIZE, rollback: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--confirm-production") args.confirmProduction = true;
    else if (value === "--mapping") args.mapping = argv[++index];
    else if (value === "--checkpoint") args.checkpoint = argv[++index];
    else if (value === "--report") args.report = argv[++index];
    else if (value === "--batch-size") args.batchSize = Number(argv[++index]);
    else if (value === "--rollback") args.rollback = argv[++index];
    else throw new Error(`Unknown migration argument: ${value}`);
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 10000) throw new Error("--batch-size must be an integer between 1 and 10000");
  if (args.mapping && args.rollback) throw new Error("--mapping and --rollback cannot be used together");
  if (args.rollback && args.apply) throw new Error("--rollback cannot be combined with --apply");
  return args;
}

function dbNameFromUri(uri) {
  const value = String(uri || "");
  const slash = value.lastIndexOf("/");
  return slash < 0 ? "" : value.slice(slash + 1).split(/[?/#]/)[0];
}

function assertProductionSafety(args, uri = env.mongoUri, nodeEnv = env.nodeEnv) {
  if (nodeEnv !== "production") return;
  if (!args.confirmProduction || process.env.MIGRATION_CONFIRM_DB !== dbNameFromUri(uri)) {
    throw new Error("Production migration refused: require --confirm-production and MIGRATION_CONFIRM_DB=<exact database name>");
  }
}

function reportPath(value) {
  return path.resolve(value || path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
}

function checkpointPath(value) {
  return path.resolve(value || path.join(REPORT_DIR, "tenant-backfill-checkpoint.json"));
}

function newCounts() {
  return { scanned: 0, updated: 0, skipped: 0, ambiguous: 0, orphaned: 0, errors: 0 };
}

function createReport(mode, dbName) {
  return {
    mode,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    dbName,
    collections: Object.fromEntries(COLLECTIONS.map((name) => [name, newCounts()])),
    duplicateMemberships: [],
    brokenLinks: [],
    legacyWorkspaces: [],
    mismatches: [],
    undo: [],
  };
}

function ensureDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function saveJson(file, value) {
  ensureDirectory(file);
  fs.writeFileSync(`${file}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function id(value) {
  return value ? String(value._id || value) : null;
}

function nullFieldFilter(_id) {
  return { _id, $or: [{ organizationId: null }, { organizationId: { $exists: false } }] };
}

function addMismatch(report, collection, document, expected) {
  report.mismatches.push({ collection, id: id(document), current: id(document.organizationId), expected: id(expected) });
}

function recordUndo(report, collection, document, organizationId) {
  report.undo.push({ collection, id: id(document), field: "organizationId", value: id(organizationId) });
}

async function loadMapping(file) {
  if (!file) return new Map();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`Unable to read mapping file: ${error.message}`);
  }
  if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Error("Mapping file must be an object of workspaceId -> organizationId");
  const entries = Object.entries(raw);
  if (entries.some(([workspaceId, organizationId]) => !mongoose.isValidObjectId(workspaceId) || !mongoose.isValidObjectId(organizationId))) {
    throw new Error("Every mapping key and value must be a valid MongoDB ObjectId");
  }
  const [workspaces, organizations] = await Promise.all([
    Workspace.find({ _id: { $in: entries.map(([workspaceId]) => workspaceId) } }).select("_id organizationId").lean(),
    Organization.find({ _id: { $in: entries.map(([, organizationId]) => organizationId) } }).select("_id").lean(),
  ]);
  const workspaceMap = new Map(workspaces.map((workspace) => [id(workspace), workspace]));
  const organizationSet = new Set(organizations.map(id));
  for (const [workspaceId, organizationId] of entries) {
    const workspace = workspaceMap.get(workspaceId);
    if (!workspace) throw new Error(`Mapping workspace does not exist: ${workspaceId}`);
    if (!organizationSet.has(organizationId)) throw new Error(`Mapping organization does not exist: ${organizationId}`);
    if (workspace.organizationId && id(workspace.organizationId) !== organizationId) throw new Error(`Workspace ${workspaceId} is already linked to a different organization`);
  }
  return new Map(entries);
}

async function duplicateMemberships() {
  return OrganizationMembership.aggregate([
    { $group: { _id: { organizationId: "$organizationId", userId: "$userId" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, organizationId: "$_id.organizationId", userId: "$_id.userId", ids: 1, count: 1 } },
  ]);
}

async function applyWorkspaceMappings(report, mapping, apply, undo) {
  const operations = [];
  for (const [workspaceId, organizationId] of mapping) {
    const workspace = await Workspace.findById(workspaceId).select("_id organizationId").lean();
    report.collections.Workspace.scanned += 1;
    if (!workspace) {
      report.collections.Workspace.orphaned += 1;
      report.brokenLinks.push({ collection: "Workspace", id: workspaceId, reason: "workspace disappeared after mapping validation" });
    } else if (workspace.organizationId) {
      report.collections.Workspace.skipped += 1;
    } else if (!apply) {
      report.collections.Workspace.updated += 1;
    } else {
      operations.push({ updateOne: { filter: nullFieldFilter(workspace._id), update: { $set: { organizationId } } } });
      recordUndo(report, "Workspace", workspace, organizationId);
    }
  }
  if (operations.length) {
    const result = await Workspace.bulkWrite(operations, { ordered: false });
    report.collections.Workspace.updated += result.modifiedCount || 0;
    if (undo) saveJson(undo, report.undo);
  }
}

async function processBatch({ model, collection, cursor, batchSize, report, apply, getParent, checkpoint, undo }) {
  const query = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};
  const documents = await model.find(query).sort({ _id: 1 }).limit(batchSize);
  if (!documents.length) return null;
  const operations = [];
  for (const document of documents) {
    report.collections[collection].scanned += 1;
    let expected;
    try {
      expected = await getParent(document);
    } catch (error) {
      report.collections[collection].errors += 1;
      report.brokenLinks.push({ collection, id: id(document), reason: error.message });
      continue;
    }
    if (expected === undefined) {
      report.collections[collection].orphaned += 1;
      report.brokenLinks.push({ collection, id: id(document), reason: "parent is missing" });
      continue;
    }
    if (document.organizationId && id(document.organizationId) !== id(expected)) {
      report.collections[collection].skipped += 1;
      addMismatch(report, collection, document, expected);
    } else if (!expected || document.organizationId) {
      report.collections[collection].skipped += 1;
    } else if (!apply) {
      report.collections[collection].updated += 1;
    } else {
      operations.push({ updateOne: { filter: nullFieldFilter(document._id), update: { $set: { organizationId: expected } } } });
      recordUndo(report, collection, document, expected);
    }
  }
  if (operations.length) {
    const result = await model.bulkWrite(operations, { ordered: false });
    report.collections[collection].updated += result.modifiedCount || 0;
    if (undo) saveJson(undo, report.undo);
  }
  const nextCursor = String(documents[documents.length - 1]._id);
  checkpoint.cursors[collection] = nextCursor;
  saveJson(checkpoint.file, checkpoint);
  return nextCursor;
}

async function processCollection(options) {
  let cursor = options.checkpoint.cursors[options.collection] || null;
  while (true) {
    const next = await processBatch({ ...options, cursor });
    if (!next) break;
    cursor = next;
  }
}

async function processParentValidation({ model, collection, batchSize, report, checkpoint }) {
  let cursor = checkpoint.cursors[collection] || null;
  while (true) {
    const query = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};
    const documents = await model.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!documents.length) break;
    for (const document of documents) {
      report.collections[collection].scanned += 1;
      try {
        const parent = collection === "Project" ? document.workspace : null;
        if (collection === "Project") {
          await document.populate("workspace");
          if (!parent && !document.workspace) {
            report.collections[collection].orphaned += 1;
            report.brokenLinks.push({ collection, id: id(document), reason: "project workspace is missing" });
          } else {
            resolveTenantFromParent(document);
            report.collections[collection].skipped += 1;
          }
        } else {
          report.collections[collection].skipped += 1;
        }
      } catch (error) {
        report.collections[collection].errors += 1;
        report.brokenLinks.push({ collection, id: id(document), reason: error.message });
      }
    }
    cursor = String(documents[documents.length - 1]._id);
    checkpoint.cursors[collection] = cursor;
    saveJson(checkpoint.file, checkpoint);
  }
}

async function notificationParents(documents) {
  const idsByType = new Map();
  for (const document of documents) {
    const meta = document.meta || {};
    const type = meta.resourceType || (meta.channelId ? "Channel" : null);
    const resourceId = meta.resourceId || meta.channelId;
    if (type && resourceId && mongoose.isValidObjectId(resourceId)) {
      if (!idsByType.has(type)) idsByType.set(type, new Set());
      idsByType.get(type).add(String(resourceId));
    }
  }
  const parents = new Map();
  const load = async (type, model, populate) => {
    const ids = [...(idsByType.get(type) || [])];
    if (!ids.length) return;
    let query = model.find({ _id: { $in: ids } });
    if (populate) query = query.populate(populate);
    const rows = await query;
    rows.forEach((row) => parents.set(`${type}:${id(row)}`, row));
  };
  await load("Organization", Organization);
  await load("Workspace", Workspace);
  await load("Project", Project, "workspace");
  await load("Channel", Channel, "workspace");
  return parents;
}

async function processNotifications({ batchSize, report, apply, undo, checkpoint }) {
  let cursor = checkpoint.cursors.Notification || null;
  while (true) {
    const query = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};
    const documents = await Notification.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!documents.length) break;
    const parents = await notificationParents(documents);
    const result = report.collections.Notification;
    const operations = [];
    for (const document of documents) {
      result.scanned += 1;
      const meta = document.meta || {};
      const type = meta.resourceType || (meta.channelId ? "Channel" : null);
      const resourceId = meta.resourceId || meta.channelId;
      if (!type || !resourceId) {
        if (document.organizationId) addMismatch(report, "Notification", document, null);
        result.skipped += 1;
        continue;
      }
      const parent = parents.get(`${type}:${resourceId}`);
      if (!parent) {
        result.orphaned += 1;
        report.brokenLinks.push({ collection: "Notification", id: id(document), reason: "notification resource is missing" });
        continue;
      }
      let expected;
      try {
        expected = resolveTenantFromParent(parent);
      } catch (error) {
        result.errors += 1;
        report.brokenLinks.push({ collection: "Notification", id: id(document), reason: error.message });
        continue;
      }
      if (document.organizationId && id(document.organizationId) !== id(expected)) {
        result.skipped += 1;
        addMismatch(report, "Notification", document, expected);
      } else if (!document.organizationId && expected) {
        if (apply) {
          operations.push({ updateOne: { filter: nullFieldFilter(document._id), update: { $set: { organizationId: expected } } } });
          recordUndo(report, "Notification", document, expected);
        } else result.updated += 1;
      } else result.skipped += 1;
    }
    if (operations.length) {
      const write = await Notification.bulkWrite(operations, { ordered: false });
      result.updated += write.modifiedCount || 0;
      if (undo) saveJson(undo, report.undo);
    }
    cursor = String(documents[documents.length - 1]._id);
    checkpoint.cursors.Notification = cursor;
    saveJson(checkpoint.file, checkpoint);
  }
}

async function migrateInternal({ apply = false, mappingFile = null, batchSize = DEFAULT_BATCH_SIZE, checkpointFile = null, undoFile = null, reportFile = null, dbName = mongoose.connection.name } = {}) {
  const report = createReport(apply ? "apply" : "dry-run", dbName);
  const checkpoint = { version: 1, status: "running", mode: report.mode, cursors: {}, file: checkpointPath(checkpointFile) };
  if (fs.existsSync(checkpoint.file)) {
    const saved = JSON.parse(fs.readFileSync(checkpoint.file, "utf8"));
    if (["running", "failed"].includes(saved.status) && saved.mode === report.mode) Object.assign(checkpoint.cursors, saved.cursors || {});
  }
  const mapping = await loadMapping(mappingFile);
  report.duplicateMemberships = await duplicateMemberships();
  report.legacyWorkspaces = (await Workspace.find({ organizationId: null }).select("_id name").lean()).map((workspace) => ({ id: id(workspace), name: workspace.name, mapped: mapping.has(id(workspace)) }));
  const undo = undoFile ? path.resolve(undoFile) : path.resolve(REPORT_DIR, `tenant-backfill-${Date.now()}.undo.json`);

  await applyWorkspaceMappings(report, mapping, apply, undo);
  await processParentValidation({ model: Workspace, collection: "Workspace", batchSize, report, checkpoint });
  await processParentValidation({ model: Project, collection: "Project", batchSize, report, checkpoint });
  await processCollection({ model: Channel, collection: "Channel", batchSize, report, apply, undo, checkpoint, getParent: async (channel) => {
    await channel.populate("workspace");
    return channel.workspace ? resolveTenantFromParent(channel.workspace) : undefined;
  }});
  await processCollection({ model: Message, collection: "Message", batchSize, report, apply, undo, checkpoint, getParent: async (message) => {
    await message.populate({ path: "channel", populate: { path: "workspace" } });
    return message.channel?.workspace ? resolveTenantFromParent(message.channel.workspace) : undefined;
  }});
  await processCollection({ model: Activity, collection: "Activity", batchSize, report, apply, undo, checkpoint, getParent: async (activity) => {
    await activity.populate("workspace");
    return activity.workspace ? resolveTenantFromParent(activity.workspace) : undefined;
  }});
  await processNotifications({ batchSize, report, apply, undo, checkpoint });
  report.finishedAt = new Date().toISOString();
  checkpoint.status = "completed";
  saveJson(checkpoint.file, checkpoint);
  const reportFilePath = reportPath(reportFile);
  saveJson(reportFilePath, report);
  saveJson(undo, report.undo);
  return { report, reportFile: reportFilePath, undoFile: undo, checkpointFile: checkpoint.file };
}

async function migrate(options = {}) {
  try {
    return await migrateInternal(options);
  } catch (error) {
    const report = createReport(options.apply ? "apply" : "dry-run", options.dbName || mongoose.connection.name);
    report.finishedAt = new Date().toISOString();
    report.error = error.message;
    saveJson(reportPath(options.reportFile), report);
    if (options.checkpointFile) {
      const file = checkpointPath(options.checkpointFile);
      let checkpoint = { version: 1, status: "failed", mode: report.mode, cursors: {}, file, error: error.message };
      if (fs.existsSync(file)) checkpoint = { ...JSON.parse(fs.readFileSync(file, "utf8")), status: "failed", error: error.message };
      saveJson(file, checkpoint);
    }
    throw error;
  }
}

async function rollback(undoFile) {
  const undo = JSON.parse(fs.readFileSync(path.resolve(undoFile), "utf8"));
  const grouped = new Map();
  for (const entry of undo) {
    if (!MODELS[entry.collection]) throw new Error(`Unsupported rollback collection: ${entry.collection}`);
    if (!grouped.has(entry.collection)) grouped.set(entry.collection, []);
    grouped.get(entry.collection).push({ updateOne: { filter: { _id: entry.id, organizationId: entry.value }, update: { $unset: { organizationId: 1 } } } });
  }
  const results = {};
  for (const [collection, operations] of grouped) results[collection] = (await MODELS[collection].bulkWrite(operations, { ordered: false })).modifiedCount || 0;
  return results;
}

async function main() {
  const args = parseArgs();
  assertProductionSafety(args);
  await connectDb();
  if (args.rollback) {
    console.log(JSON.stringify({ mode: "rollback", results: await rollback(args.rollback) }, null, 2));
    return;
  }
  const result = await migrate({ apply: args.apply, mappingFile: args.mapping, batchSize: args.batchSize, checkpointFile: args.checkpoint, reportFile: args.report });
  console.log(JSON.stringify({ mode: result.report.mode, reportFile: result.reportFile, undoFile: result.undoFile, checkpointFile: result.checkpointFile }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Tenant migration failed:", error.message);
    process.exitCode = 1;
  }).finally(disconnectDb);
}

module.exports = { COLLECTIONS, parseArgs, dbNameFromUri, assertProductionSafety, loadMapping, createReport, migrate, rollback };
