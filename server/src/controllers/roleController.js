const mongoose = require("mongoose");
const { z } = require("zod");
const Role = require("../models/Role");
const OrganizationMembership = require("../models/OrganizationMembership");
const { AppError, asyncHandler } = require("../utils/errors");
const { secureBody } = require("../utils/inputSecurity");
const { isKnownPermission } = require("../config/permissionCatalog");
const { requirePermission } = require("../services/tenantAccess");
const { permissionsForMembership, legacyRoleForRole } = require("../services/roleService");
const { assertOwnerInvariant, syncMembershipToRole } = require("../utils/organizationMembership");
const { recordAdminEvent } = require("../utils/adminEvents");
const { revokeUser, grantUser, roomsForOrganization } = require("../services/realtimeAccess");

const permissionList = z.array(z.string()).max(100).refine(
  (permissions) => permissions.every(isKnownPermission),
  { message: "Unknown permission string" }
);

const roleCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: secureBody(z.object({
    name: z.string().trim().min(2).max(80),
    key: z.string().trim().min(2).max(80).regex(/^[a-z][a-z0-9_\-]*$/),
    permissions: permissionList,
  }).strict(), ["permissions"]),
});

const roleUpdateSchema = z.object({
  params: z.object({ id: z.string(), roleId: z.string() }),
  body: secureBody(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    key: z.string().trim().min(2).max(80).regex(/^[a-z][a-z0-9_\-]*$/).optional(),
    permissions: permissionList.optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: "Provide at least one role change" }), ["permissions"]),
});

const roleDeleteSchema = z.object({
  params: z.object({ id: z.string(), roleId: z.string() }),
  body: secureBody(z.object({ reassignRoleId: z.string().optional() }).strict()),
});

const roleAssignmentSchema = z.object({
  params: z.object({ id: z.string(), userId: z.string() }),
  body: secureBody(z.object({ roleId: z.string() }).strict()),
});

function notFound() {
  return new AppError("Role not found", 404);
}

function assertObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${label} not found`, 404);
}

async function actorFor(organization, user) {
  return requirePermission("org.manage_roles", organization, user);
}

async function assertWithinActor(actorMembership, permissions) {
  const held = new Set(await permissionsForMembership(actorMembership));
  if (permissions.some((permission) => !held.has(permission))) {
    throw new AppError("You cannot grant or manage permissions you do not hold", 403);
  }
}

async function findTenantRole(organizationId, roleId) {
  assertObjectId(roleId, "Role");
  const role = await Role.findOne({ _id: roleId, organizationId });
  if (!role) throw notFound();
  return role;
}

async function refreshRoleMembers(io, organizationId, userIds) {
  if (!userIds.length) return;
  try {
    const rooms = await roomsForOrganization(organizationId);
    for (const userId of [...new Set(userIds.map(String))]) {
      await revokeUser(io, organizationId, userId, rooms);
      await grantUser(io, organizationId, userId, rooms);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "realtime.role_refresh_failed", organizationId: String(organizationId), error: error.message }));
  }
}

const list = asyncHandler(async (req, res) => {
  await actorFor(req.organization, req.user);
  const roles = await Role.find({ organizationId: req.organization._id }).sort({ isSystem: -1, name: 1 }).lean();
  res.json({ roles });
});

const create = asyncHandler(async (req, res) => {
  const actor = await actorFor(req.organization, req.user);
  await assertWithinActor(actor, req.body.permissions);
  const role = await Role.create({
    organizationId: req.organization._id,
    name: req.body.name,
    key: req.body.key,
    permissions: req.body.permissions,
    isSystem: false,
  });
  recordAdminEvent({ organizationId: req.organization._id, actorId: req.user._id, action: "role_created", role: role.key });
  res.status(201).json({ role });
});

const update = asyncHandler(async (req, res) => {
  const actor = await actorFor(req.organization, req.user);
  const role = await findTenantRole(req.organization._id, req.params.roleId);
  if (role.isSystem) throw new AppError("System roles are read-only", 403);
  const affectedMembers = await OrganizationMembership.find({ organizationId: req.organization._id, roleId: role._id, status: "active" }).select("userId").lean();
  const permissions = req.body.permissions === undefined ? role.permissions : req.body.permissions;
  await assertWithinActor(actor, role.permissions);
  await assertWithinActor(actor, permissions);
  if (req.body.name !== undefined) role.name = req.body.name;
  if (req.body.key !== undefined) role.key = req.body.key;
  role.permissions = permissions;
  await role.save();
  recordAdminEvent({ organizationId: req.organization._id, actorId: req.user._id, action: "role_updated", role: role.key });
  await refreshRoleMembers(req.app.get("io"), req.organization._id, affectedMembers.map((member) => member.userId));
  res.json({ role });
});

const remove = asyncHandler(async (req, res) => {
  const actor = await actorFor(req.organization, req.user);
  const role = await findTenantRole(req.organization._id, req.params.roleId);
  if (role.isSystem) throw new AppError("System roles are read-only", 403);
  await assertWithinActor(actor, role.permissions);
  const memberCount = await OrganizationMembership.countDocuments({ organizationId: req.organization._id, roleId: role._id, status: { $ne: "revoked" } });
  let replacement = null;
  let affectedReassigned = [];
  if (memberCount) {
    if (!req.body.reassignRoleId) throw new AppError("Reassignment is required before deleting a role with members", 409);
    replacement = await findTenantRole(req.organization._id, req.body.reassignRoleId);
    if (String(replacement._id) === String(role._id)) throw new AppError("Choose a different reassignment role", 400);
    await assertWithinActor(actor, replacement.permissions);
  }
  if (replacement) {
    const legacyRole = legacyRoleForRole(replacement);
    const members = await OrganizationMembership.find({ organizationId: req.organization._id, roleId: role._id, status: { $ne: "revoked" } }).select("userId");
    affectedReassigned = members.map((member) => member.userId);
    await OrganizationMembership.updateMany(
      { organizationId: req.organization._id, roleId: role._id, status: { $ne: "revoked" } },
      { $set: { roleId: replacement._id, role: legacyRole } }
    );
    members.forEach(({ userId }) => {
      const member = req.organization.members.find((item) => String(item.user) === String(userId));
      if (member) member.role = legacyRole;
    });
    await req.organization.save();
  }
  await Role.deleteOne({ _id: role._id, organizationId: req.organization._id });
  recordAdminEvent({ organizationId: req.organization._id, actorId: req.user._id, action: "role_deleted", role: role.key });
  if (replacement) await refreshRoleMembers(req.app.get("io"), req.organization._id, affectedReassigned);
  res.status(204).end();
});

const assign = asyncHandler(async (req, res) => {
  const actor = await actorFor(req.organization, req.user);
  const role = await findTenantRole(req.organization._id, req.body.roleId);
  await assertWithinActor(actor, role.permissions);
  assertObjectId(req.params.userId, "Member");
  const membership = await OrganizationMembership.findOne({ organizationId: req.organization._id, userId: req.params.userId, status: "active" });
  const embedded = req.organization.members.find((member) => String(member.user) === String(req.params.userId));
  if (!membership || !embedded) throw new AppError("Member not found", 404);
  await assertOwnerInvariant(req.organization._id, membership, legacyRoleForRole(role));
  await syncMembershipToRole(membership, role);
  await membership.save();
  embedded.role = legacyRoleForRole(role);
  await req.organization.save();
  recordAdminEvent({ organizationId: req.organization._id, actorId: req.user._id, targetUserId: req.params.userId, action: "role_assigned", role: role.key });
  const rooms = await roomsForOrganization(req.organization._id);
  await revokeUser(req.app.get("io"), req.organization._id, req.params.userId, rooms);
  await grantUser(req.app.get("io"), req.organization._id, req.params.userId, rooms);
  res.json({ membership: { ...membership.toObject(), roleId: role._id, role: legacyRoleForRole(role) } });
});

module.exports = { roleCreateSchema, roleUpdateSchema, roleDeleteSchema, roleAssignmentSchema, list, create, update, remove, assign };
