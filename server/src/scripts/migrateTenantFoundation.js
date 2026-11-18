/*
 * Tenant foundation inventory/backfill.
 *
 * Dry-run is the default. Apply only after a verified database backup:
 *   node src/scripts/migrateTenantFoundation.js --apply
 *
 * This migration deliberately does not guess an organization for legacy
 * workspaces that have no organizationId. Those records are reported for
 * explicit mapping in a later migration step.
 */
const mongoose = require("mongoose");
const { connectDb, disconnectDb } = require("../config/db");
const Organization = require("../models/Organization");
const Workspace = require("../models/Workspace");
const User = require("../models/User");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Notification = require("../models/Notification");

const apply = process.argv.includes("--apply");

function slugBase(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "organization";
}

async function makeSlug(name, used) {
  const base = slugBase(name);
  let slug = base;
  let suffix = 2;
  while (used.has(slug) || await Organization.exists({ slug })) {
    slug = `${base}-${suffix}`.slice(0, 100);
    suffix += 1;
  }
  used.add(slug);
  return slug;
}

async function inventory() {
  const [users, organizations, workspaces, projects, tasks, channels, messages, notifications] = await Promise.all([
    User.countDocuments(), Organization.countDocuments(), Workspace.countDocuments(), Project.countDocuments(),
    Task.countDocuments(), Channel.countDocuments(), Message.countDocuments(), Notification.countDocuments(),
  ]);
  const [legacyWorkspaces, brokenOrgLinks, duplicateMembershipGroups] = await Promise.all([
    Workspace.countDocuments({ organizationId: null }),
    Workspace.aggregate([
      { $match: { organizationId: { $exists: true, $ne: null } } },
      { $lookup: { from: "organizations", localField: "organizationId", foreignField: "_id", as: "organization" } },
      { $match: { organization: { $size: 0 } } },
      { $count: "count" },
    ]),
    Organization.aggregate([
      { $unwind: "$members" },
      { $group: { _id: { organization: "$_id", user: "$members.user" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "groups" },
    ]),
  ]);
  return {
    documents: { users, organizations, workspaces, projects, tasks, channels, messages, notifications },
    unresolved: { workspacesWithoutOrganization: legacyWorkspaces, brokenOrganizationLinks: brokenOrgLinks[0]?.count || 0, duplicateMembershipGroups: duplicateMembershipGroups[0]?.groups || 0 },
  };
}

async function applySafeBackfill() {
  const organizations = await Organization.find({}).sort({ createdAt: 1 });
  const used = new Set();
  let updated = 0;
  for (const organization of organizations) {
    let changed = false;
    if (!organization.slug) { organization.slug = await makeSlug(organization.name, used); changed = true; }
    else used.add(organization.slug);
    if (!organization.ownerId) { organization.ownerId = organization.createdBy; changed = true; }
    if (!organization.status) { organization.status = "active"; changed = true; }
    if (!organization.settings) organization.settings = {};
    if (!organization.settings?.onboardingState) { organization.settings.onboardingState = "development"; changed = true; }
    organization.members.forEach((member) => {
      if (!member.status) { member.status = "active"; changed = true; }
    });
    if (changed) { await organization.save(); updated += 1; }
  }
  return updated;
}

(async () => {
  await connectDb();
  const report = await inventory();
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", report }, null, 2));
  if (apply) {
    console.log(`Backfilling only deterministic organization metadata...`);
    console.log(`Updated organizations: ${await applySafeBackfill()}`);
    console.log("No legacy workspace was assigned to an organization automatically.");
  } else {
    console.log("Dry-run complete. No database writes were performed.");
    console.log("Before --apply: create and verify a backup, then explicitly map unresolved workspaces.");
  }
})().catch((error) => {
  console.error("Tenant migration failed:", error.message);
  process.exitCode = 1;
}).finally(disconnectDb);
