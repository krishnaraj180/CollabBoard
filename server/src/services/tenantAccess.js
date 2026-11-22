const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const OrganizationMembership = require("../models/OrganizationMembership");
const Workspace = require("../models/Workspace");
const Channel = require("../models/Channel");
const Role = require("../models/Role");
const { isKnownPermission } = require("../config/permissionCatalog");
const { legacyToSystemRole } = require("./roleMapping");
const { memberOf } = require("../utils/access");
const { AppError } = require("../utils/errors");
const { tenantNotFound, organizationSuspended } = require("../utils/tenantErrors");
const { env } = require("../config/env");

const STATUS_PRIORITY = { active: 0, suspended: 1, revoked: 2 };
const ROLE_PRIORITY = {
  viewer: 0,
  qa_tester: 1,
  developer: 1,
  team_lead: 2,
  project_manager: 2,
  business_management: 2,
  organization_admin: 3,
  organization_owner: 4,
};
const MODE = ["off", "log", "on"];

function enforcementMode() {
  const value = String(env.tenantEnforcement || "off").toLowerCase();
  return MODE.includes(value) ? value : "off";
}

function legacyWorkspaceMembership(workspace, userId) {
  return workspace?.organizationId ? null : (memberOf(workspace, userId) || null);
}

async function membershipRecord(userId, organizationId) {
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(organizationId)) return null;
  const memberships = await OrganizationMembership.find({ userId, organizationId }).select("role roleId status department title joinedAt").lean();
  if (!memberships.length) return null;
  memberships.sort((a, b) => {
    const statusDifference = (STATUS_PRIORITY[b.status] || 0) - (STATUS_PRIORITY[a.status] || 0);
    return statusDifference || (ROLE_PRIORITY[a.role] || 0) - (ROLE_PRIORITY[b.role] || 0);
  });
  const strongest = memberships[0];
  if (memberships.length > 1) {
    console.warn(JSON.stringify({ event: "tenant.duplicate_membership", userId: String(userId), organizationId: String(organizationId), count: memberships.length }));
  }
  return strongest;
}

async function getMembership(userId, organizationId) {
  const membership = await membershipRecord(userId, organizationId);
  return membership?.status === "active" ? membership : null;
}

async function activeOrganizationsFor(userId) {
  const memberships = await OrganizationMembership.find({ userId }).select("organizationId status role").lean();
  const grouped = new Map();
  for (const membership of memberships) {
    const key = String(membership.organizationId);
    const current = grouped.get(key);
    if (!current || (STATUS_PRIORITY[membership.status] || 0) > (STATUS_PRIORITY[current.status] || 0)) grouped.set(key, membership);
  }
  const activeIds = [...grouped.values()].filter((membership) => membership.status === "active").map((membership) => membership.organizationId);
  if (!activeIds.length) return [];
  const activeOrganizations = await Organization.find({ _id: { $in: activeIds }, status: "active" }).select("_id").lean();
  return activeOrganizations.map((organization) => organization._id);
}

async function legacyWorkspacesFor(userId) {
  return Workspace.find({ organizationId: null, "members.user": userId }).select("_id").lean();
}

function id(value) {
  return value ? String(value._id || value) : null;
}

function isModel(Model, name) {
  return Model?.modelName === name;
}

async function workspaceAccess(workspace, user) {
  if (!workspace) return { allowed: false };
  if (!workspace.organizationId) return { allowed: Boolean(legacyWorkspaceMembership(workspace, user._id)), workspace };
  const organization = await Organization.findById(workspace.organizationId).select("status").lean();
  const membershipRecordForUser = await membershipRecord(user._id, workspace.organizationId);
  if (organization?.status === "suspended" && membershipRecordForUser?.status === "active") throw organizationSuspended();
  const membership = membershipRecordForUser?.status === "active" ? membershipRecordForUser : null;
  return { allowed: Boolean(membership || user.platformRole === "super_admin"), workspace, organization, membership };
}

async function tenantCandidate(Model, idValue, user) {
  if (!mongoose.isValidObjectId(idValue)) return null;
  if (user.platformRole === "super_admin") {
    const query = Model.findOne({ _id: idValue });
    if (["Project", "Task", "Channel"].includes(Model.modelName)) query.populate("workspace");
    if (Model.modelName === "Message") query.populate({ path: "channel", populate: { path: "workspace" } });
    return query;
  }
  const organizationIds = await activeOrganizationsFor(user._id);
  const legacyIds = (await legacyWorkspacesFor(user._id)).map((workspace) => workspace._id);
  const organizationWorkspaceIds = (await Workspace.find({ organizationId: { $in: organizationIds } }).select("_id").lean()).map((workspace) => workspace._id);
  const permittedWorkspaceIds = [...organizationWorkspaceIds, ...legacyIds];
  let document = null;

  if (isModel(Model, "Organization")) {
    document = await Model.findOne({ _id: idValue });
    if (!document) return null;
    const membershipRecordForUser = await membershipRecord(user._id, document._id);
    if (document.status === "suspended" && membershipRecordForUser?.status === "active") throw organizationSuspended();
    const membership = membershipRecordForUser?.status === "active" ? membershipRecordForUser : null;
    return membership || user.platformRole === "super_admin" ? document : null;
  }
  if (isModel(Model, "Workspace")) {
    document = await Model.findOne({ _id: idValue, $or: [{ organizationId: { $in: organizationIds } }, { organizationId: null, _id: { $in: legacyIds } }] });
    if (!document) return null;
    const access = await workspaceAccess(document, user);
    return access.allowed ? document : null;
  }
  if (isModel(Model, "Channel")) {
    document = await Model.findOne({ _id: idValue, $or: [{ organizationId: { $in: organizationIds } }, { organizationId: null, workspace: { $in: legacyIds } }] }).populate("workspace");
    if (!document) return null;
    return (await workspaceAccess(document.workspace, user)).allowed ? document : null;
  }
  if (isModel(Model, "Message")) {
    document = await Model.findOne({ _id: idValue, $or: [{ organizationId: { $in: organizationIds } }, { organizationId: null, workspace: { $in: legacyIds } }] }).populate({ path: "channel", populate: { path: "workspace" } });
    if (!document || !document.channel?.workspace) return null;
    return (await workspaceAccess(document.channel.workspace, user)).allowed ? document : null;
  }
  if (isModel(Model, "Project")) {
    document = await Model.findOne({ _id: idValue, workspace: { $in: permittedWorkspaceIds } }).populate("workspace");
    if (!document || !(await workspaceAccess(document.workspace, user)).allowed) return null;
    return document;
  }
  if (isModel(Model, "Task")) {
    document = await Model.findOne({ _id: idValue, workspace: { $in: permittedWorkspaceIds } }).populate("workspace project");
    if (!document || !(await workspaceAccess(document.workspace, user)).allowed) return null;
    return document;
  }
  return null;
}

function applyPopulate(query, populate) {
  if (!populate) return query;
  for (const item of Array.isArray(populate) ? populate : [populate]) query.populate(item);
  return query;
}

async function loadTenantResource(Model, idValue, user, { populate, route = Model.modelName } = {}) {
  const mode = enforcementMode();
  if (mode === "off") {
    if (!mongoose.isValidObjectId(idValue)) throw tenantNotFound();
    const resource = await applyPopulate(Model.findById(idValue), populate);
    if (!resource) throw tenantNotFound();
    return resource;
  }

  const shadow = async () => tenantCandidate(Model, idValue, user);
  if (mode === "log") {
    let oldResource;
    try {
      oldResource = !mongoose.isValidObjectId(idValue) ? null : await applyPopulate(Model.findById(idValue), populate);
      Promise.resolve().then(async () => {
        try {
          const newResource = await shadow();
          const oldOutcome = oldResource ? "allowed" : "not_found";
          const newOutcome = newResource ? "allowed" : "not_found";
          if (oldOutcome !== newOutcome) console.warn(JSON.stringify({ route, userId: String(user._id), resourceId: String(idValue), oldOutcome, newOutcome, timestamp: new Date().toISOString() }));
        } catch (error) {
          console.warn(JSON.stringify({ route, userId: String(user._id), resourceId: String(idValue), oldOutcome: "shadow_error", newOutcome: error.name, timestamp: new Date().toISOString() }));
        }
      });
      if (!oldResource) throw tenantNotFound();
      return oldResource;
    } catch (error) {
      throw error;
    }
  }
  const resource = await shadow();
  if (!resource) throw tenantNotFound();
  return resource;
}

async function listScope(userId) {
  const [organizationIds, legacyWorkspaces] = await Promise.all([activeOrganizationsFor(userId), legacyWorkspacesFor(userId)]);
  return { organizationIds, legacyWorkspaceIds: legacyWorkspaces.map((workspace) => workspace._id) };
}

function resourceOrganizationId(resource) {
  if (!resource) return null;
  if (resource.constructor?.modelName === "Organization") return resource._id;
  if (resource.organizationId) return resource.organizationId;
  if (resource.workspace?.organizationId) return resource.workspace.organizationId;
  if (resource.project?.workspace?.organizationId) return resource.project.workspace.organizationId;
  if (resource.channel?.workspace?.organizationId) return resource.channel.workspace.organizationId;
  return null;
}

async function requirePermission(permission, resource, user) {
  if (!isKnownPermission(permission)) throw new TypeError(`Unknown permission string: ${permission}`);
  if (!resource || !user) throw tenantNotFound();
  if (user.platformRole === "super_admin") return null;
  const organizationId = resourceOrganizationId(resource);
  if (!organizationId) {
    const workspace = resource.workspace?.organizationId === undefined ? resource.workspace : resource;
    const legacyMembership = legacyWorkspaceMembership(workspace, user._id);
    if (!legacyMembership) throw tenantNotFound();
    return legacyMembership;
  }
  const membership = await getMembership(user._id, organizationId);
  if (!membership) throw tenantNotFound();
  let permissions;
  if (membership.roleId) {
    const role = await Role.findOne({ _id: membership.roleId, organizationId }).select("permissions").lean();
    permissions = role?.permissions;
  }
  if (!permissions) permissions = legacyToSystemRole(membership.role).permissions;
  if (permissions.includes(permission)) return membership;
  throw new AppError(`Insufficient organization permissions: cannot perform "${permission}"`, 403);
}

module.exports = { enforcementMode, getMembership, activeOrganizationsFor, legacyWorkspaceMembership, legacyWorkspacesFor, loadTenantResource, listScope, requirePermission, resourceOrganizationId };
