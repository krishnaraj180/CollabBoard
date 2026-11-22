const Role = require("../models/Role");
const Organization = require("../models/Organization");
const { legacyToSystemRole, SYSTEM_ROLE_DEFINITIONS } = require("./roleMapping");

async function seedSystemRoles(organizationId, { apply = true } = {}) {
  const OrganizationMembership = require("../models/OrganizationMembership");
  const existing = await Role.find({ organizationId, isSystem: true }).select("_id key name permissions").lean();
  const existingKeys = new Set(existing.map((role) => role.key));
  const changes = SYSTEM_ROLE_DEFINITIONS.filter((definition) => !existingKeys.has(definition.key));
  if (!apply) return { created: changes.length, linked: 0, changes };
  const roles = new Map(existing.map((role) => [role.key, role]));
  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    const role = await Role.findOneAndUpdate(
      { organizationId, key: definition.key },
      { $set: { name: definition.name, permissions: definition.permissions, isSystem: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    roles.set(definition.key, role);
  }
  const organization = await Organization.findById(organizationId).select("members").lean();
  let linked = 0;
  if (organization) {
    const updates = [];
    for (const member of organization.members) {
      const definition = legacyToSystemRole(member.role);
      const role = roles.get(definition.key);
      if (role) updates.push({ updateOne: { filter: { organizationId, userId: member.user, $or: [{ roleId: null }, { roleId: { $ne: role._id } }] }, update: { $set: { roleId: role._id } } } });
    }
    if (updates.length) {
      const result = await OrganizationMembership.bulkWrite(updates, { ordered: false });
      linked = result.modifiedCount || 0;
    }
  }
  return { created: changes.length, linked, changes: [] };
}

async function resolveRoleForMembership(organizationId, legacyRole) {
  const definition = legacyToSystemRole(legacyRole);
  return Role.findOne({ organizationId, key: definition.key }).select("_id key name permissions").lean();
}

async function permissionsForMembership(membership) {
  if (!membership) return [];
  if (membership.roleId) {
    const role = await Role.findOne({ _id: membership.roleId, organizationId: membership.organizationId })
      .select("permissions")
      .lean();
    if (role) return role.permissions;
  }
  return legacyToSystemRole(membership.role).permissions;
}

function legacyRoleForRole(role) {
  if (!role?.isSystem) return "member";
  const definition = SYSTEM_ROLE_DEFINITIONS.find((item) => item.key === role.key);
  return definition?.legacyRoles[0] || "member";
}

module.exports = { SYSTEM_ROLE_DEFINITIONS, seedSystemRoles, resolveRoleForMembership, permissionsForMembership, legacyRoleForRole };
