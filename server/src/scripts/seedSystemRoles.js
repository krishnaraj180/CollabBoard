const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const OrganizationMembership = require("../models/OrganizationMembership");
const Role = require("../models/Role");
const { connectDb } = require("../config/db");
const { env } = require("../config/env");
const { seedSystemRoles } = require("../services/roleService");
const { SYSTEM_ROLE_DEFINITIONS, legacyToSystemRole } = require("../services/roleMapping");

const reportDirectory = path.join(__dirname, "../../migration-reports");

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDb(env.mongoUri);
  fs.mkdirSync(reportDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = { mode: apply ? "apply" : "dry-run", startedAt: new Date().toISOString(), organizations: [], unmappableRoles: [], changed: 0 };
  const undo = [];
  const knownLegacyRoles = new Set(SYSTEM_ROLE_DEFINITIONS.flatMap((definition) => definition.legacyRoles));

  for (const organization of await Organization.find({}).select("_id members").lean()) {
    const unknownRoles = organization.members.filter((member) => !knownLegacyRoles.has(member.role));
    for (const member of unknownRoles) report.unmappableRoles.push({ organizationId: String(organization._id), userId: String(member.user), legacyRole: member.role, fallback: "viewer" });
    if (apply) {
      const result = await seedSystemRoles(organization._id, { apply: true });
      report.organizations.push({ organizationId: String(organization._id), ...result });
      for (const membership of await OrganizationMembership.find({ organizationId: organization._id }).select("_id userId role roleId").lean()) {
        const definition = legacyToSystemRole(membership.role);
        const role = await Role.findOne({ organizationId: organization._id, key: definition.key }).select("_id").lean();
        if (role && String(role._id) !== String(membership.roleId || "")) undo.push({ collection: "organizationmemberships", _id: String(membership._id), field: "roleId", previous: membership.roleId || null, written: role._id });
      }
      report.changed += result.linked;
    } else {
      const result = await seedSystemRoles(organization._id, { apply: false });
      report.organizations.push({ organizationId: String(organization._id), ...result });
    }
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(reportDirectory, `${timestamp}.json`), JSON.stringify(report, null, 2));
  if (apply) fs.writeFileSync(path.join(reportDirectory, `${timestamp}.undo.json`), JSON.stringify({ createdAt: report.finishedAt, changes: undo }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
