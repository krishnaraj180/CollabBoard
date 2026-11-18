const crypto = require("crypto");
const { z } = require("zod");
const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const OrganizationInvitation = require("../models/OrganizationInvitation");
const ProjectProposal = require("../models/ProjectProposal");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const User = require("../models/User");
const { AppError, asyncHandler } = require("../utils/errors");
const { requireOrganizationPermission } = require("../utils/organizationAccess");
const { getMemberUserId } = require("../utils/access");
const { notifyUsers } = require("../utils/notify");
const { isOnline, emitToWorkspace } = require("../sockets");
const OrganizationMembership = require("../models/OrganizationMembership");
const {
  createMembership,
  findMembership,
  assertOwnerInvariant,
} = require("../utils/organizationMembership");
const { loadTenantResource } = require("../services/tenantAccess");
const { activeOrganizationsFor } = require("../services/tenantAccess");

const roles = Organization.ORGANIZATION_ROLES;
const createSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional().default(""),
    industry: z.string().trim().max(80).optional().default(""),
    companySize: z.string().trim().max(40).optional().default(""),
    logo: z.string().url().max(500).optional().or(z.literal("")).default(""),
    website: z.string().trim().max(200).optional().default(""),
  }).strict(),
});
const updateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    industry: z.string().trim().max(80).optional(),
    companySize: z.string().trim().max(40).optional(),
    logo: z.string().url().max(500).optional().or(z.literal("")),
    website: z.string().trim().max(200).optional(),
    defaultTaskCapacity: z.number().int().min(1).max(100).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: "Provide at least one organization setting" }),
});
const locationCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80),
    address: z.string().trim().min(1).max(500),
    contactName: z.string().trim().max(80).optional().default(""),
    contactEmail: z.string().trim().max(254).email().or(z.literal("")).optional().default(""),
    contactPhone: z.string().trim().max(40).optional().default(""),
    workspaceId: z.string().nullable().optional(),
  }),
});
const locationUpdateSchema = z.object({
  params: z.object({ id: z.string(), locationId: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    contactName: z.string().trim().max(80).optional(),
    contactEmail: z.string().trim().max(254).email().or(z.literal("")).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    workspaceId: z.string().nullable().optional(),
  }).refine((body) => Object.keys(body).length > 0, { message: "Provide at least one location change" }),
});
const locationDeleteSchema = z.object({
  params: z.object({ id: z.string(), locationId: z.string() }),
});
const inviteSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    email: z.string().trim().email().max(254),
    role: z.enum(roles).default("viewer"),
  }),
});
const acceptInvitationSchema = z.object({
  body: z.object({ token: z.string().min(32).max(128) }).strict(),
});
const departmentCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).optional().default(""),
    positions: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  }).refine(({ positions }) => new Set(positions.map((position) => position.toLowerCase())).size === positions.length, {
    message: "Position names must be unique",
  }),
});
const departmentUpdateSchema = z.object({
  params: z.object({ id: z.string(), departmentId: z.string() }),
  body: z.object({
    description: z.string().trim().max(300).optional(),
    positions: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    managerId: z.string().nullable().optional(),
    active: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, { message: "Provide at least one department setting" })
    .refine(({ positions }) => !positions || new Set(positions.map((position) => position.toLowerCase())).size === positions.length, {
      message: "Position names must be unique",
    }),
});
const memberUpdateSchema = z.object({
  params: z.object({ id: z.string(), userId: z.string() }),
  body: z.object({
    role: z.enum(roles).optional(),
    department: z.string().trim().max(60).optional(),
    title: z.string().trim().max(60).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: "Provide at least one member change" }),
});
const workspaceLinkSchema = z.object({
  params: z.object({ id: z.string(), workspaceId: z.string() }),
});
const proposalCreateSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().trim().min(2).max(80),
    clientName: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2).max(400),
    quotation: z.number().min(0),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("INR"),
    startDate: z.coerce.date(),
    expectedCompletionDate: z.coerce.date(),
  }).refine(({ startDate, expectedCompletionDate }) => expectedCompletionDate >= startDate, {
    message: "Expected completion date must be on or after the proposed start date",
  }),
});
const proposalDecisionSchema = z.object({
  params: z.object({ id: z.string(), proposalId: z.string() }),
  body: z.object({
    action: z.enum(["approve", "reject"]),
    locationIds: z.array(z.string()).max(50).optional().default([]),
    note: z.string().trim().max(1000).optional().default(""),
  }).refine(({ action, locationIds }) => action !== "approve" || locationIds.length > 0, {
    message: "Select at least one location for an approved project",
  }),
});

function assertObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`Invalid ${label}`, 400);
}

function slugBase(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "organization";
}

async function uniqueSlug(name) {
  const base = slugBase(name);
  let slug = base;
  let suffix = 2;
  while (await Organization.exists({ slug })) {
    slug = `${base}-${suffix}`.slice(0, 100);
    suffix += 1;
  }
  return slug;
}

async function loadOrganization(id, user) {
  return loadTenantResource(Organization, id, user, { route: "organizations" });
}

async function formatOrganization(organization) {
  await organization.populate([
    { path: "members.user", select: "name email avatarColor lastSeenAt platformRole" },
    { path: "departments.manager", select: "name email avatarColor" },
    { path: "locations.workspace", select: "name description" },
  ]);
  const workspaces = await Workspace.find({ organizationId: organization._id }).select("name description");
  return { ...organization.toObject(), workspaces };
}

async function formatProposal(proposal, organization) {
  await proposal.populate([
    { path: "submittedBy", select: "name email avatarColor" },
    { path: "decision.actor", select: "name email avatarColor" },
    { path: "projects", select: "name workspace workflowStage" },
  ]);
  const proposalObject = proposal.toObject();
  proposalObject.locations = organization.locations.filter((location) =>
    proposal.locations.some((id) => String(id) === String(location._id))
  );
  return proposalObject;
}

function publicInvitation(invitation) {
  return {
    id: invitation._id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitedBy: invitation.invitedBy,
  };
}

function assertUniqueNames(values, label) {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    throw new AppError(`${label} must be unique`, 400);
  }
}

async function setLocationWorkspace(organization, location, workspaceId, userId) {
  assertObjectId(workspaceId, "workspace id");
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw new AppError("Workspace not found", 404);
  await assertWorkspaceAdmin(workspace, userId, organization);
  if (workspace.organizationId && String(workspace.organizationId) !== String(organization._id)) {
    throw new AppError("Workspace is already linked to another organization", 409);
  }
  await assertSingleLocationMembership(organization, workspace);
  if (organization.locations.some((item) =>
    String(item._id) !== String(location._id) &&
    String(item.workspace?._id || item.workspace || "") === String(workspace._id)
  )) {
    throw new AppError("A workspace can only be assigned to one company location", 409);
  }
  workspace.organizationId = organization._id;
  const workspaceOwners = workspace.members.filter((member) => ["owner", "admin"].includes(member.role)).map(getMemberUserId);
  workspaceOwners.forEach((userId) => {
    if (userId && !organization.members.some((member) => getMemberUserId(member) === userId)) {
      organization.members.push({ user: userId, role: "viewer", status: "active" });
    }
  });
  await workspace.save();
  location.workspace = workspace._id;
}

async function assertSingleLocationMembership(organization, workspace) {
  const globalMemberIds = new Set(organization.members
    .filter((member) => ["organization_admin", "business_management"].includes(member.role))
    .map(getMemberUserId));
  const otherWorkspaces = await Workspace.find({
    organizationId: organization._id,
    _id: { $ne: workspace._id },
  }).select("members");
  const currentMemberIds = workspace.members
    .map(getMemberUserId)
    .filter((userId) => userId && !globalMemberIds.has(userId));
  const duplicate = otherWorkspaces.some((otherWorkspace) =>
    otherWorkspace.members.some((member) => currentMemberIds.includes(getMemberUserId(member)))
  );
  if (duplicate) {
    throw new AppError("An employee can belong to only one location in this company", 409);
  }
}

const list = asyncHandler(async (req, res) => {
  const organizationIds = req.user.platformRole === "super_admin" ? null : await activeOrganizationsFor(req.user._id);
  const query = organizationIds ? { _id: { $in: organizationIds } } : {};
  const organizations = await Organization.find(query).sort({ name: 1 });
  const result = await Promise.all(organizations.map(formatOrganization));
  res.json({ organizations: result });
});

const create = asyncHandler(async (req, res) => {
  const duplicate = await Organization.exists({ createdBy: req.user._id, name: req.body.name });
  if (duplicate) throw new AppError("You already created an organization with this name", 409);
  const organization = await Organization.create({
    name: req.body.name,
    slug: await uniqueSlug(req.body.name),
    description: req.body.description,
    industry: req.body.industry,
    companySize: req.body.companySize,
    logo: req.body.logo,
    website: req.body.website,
    createdBy: req.user._id,
    ownerId: req.user._id,
    status: "active",
    settings: { onboardingState: "development" },
    members: [{ user: req.user._id, role: "organization_admin", status: "active" }],
  });
  await createMembership({
    organizationId: organization._id,
    userId: req.user._id,
    role: "organization_owner",
  });
  res.status(201).json({ organization: await formatOrganization(organization) });
});

const getOne = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  const membership = await requireOrganizationPermission(organization, req.user, "organization:read");
  res.json({
    organization: await formatOrganization(organization),
    myRole: req.user.platformRole === "super_admin" ? "super_admin" : membership.role,
    isSuperAdmin: req.user.platformRole === "super_admin",
  });
});

const update = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:update");
  for (const key of ["name", "description", "industry", "companySize", "logo", "website"]) {
    if (req.body[key] !== undefined) organization[key] = req.body[key];
  }
  if (req.body.defaultTaskCapacity !== undefined) {
    organization.settings.defaultTaskCapacity = req.body.defaultTaskCapacity;
  }
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const createLocation = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:update");
  assertUniqueNames([req.body.name, ...organization.locations.map((location) => location.name)], "Location names");
  const { workspaceId, ...locationData } = req.body;
  const location = organization.locations.create(locationData);
  organization.locations.push(location);
  if (workspaceId) await setLocationWorkspace(organization, location, workspaceId, req.user._id);
  await organization.save();
  res.status(201).json({ organization: await formatOrganization(organization) });
});

const updateLocation = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:update");
  assertObjectId(req.params.locationId, "location id");
  const location = organization.locations.id(req.params.locationId);
  if (!location) throw new AppError("Location not found", 404);
  if (req.body.name !== undefined) {
    assertUniqueNames(
      [req.body.name, ...organization.locations.filter((item) => String(item._id) !== req.params.locationId).map((item) => item.name)],
      "Location names"
    );
  }
  for (const key of ["name", "address", "contactName", "contactEmail", "contactPhone"]) {
    if (req.body[key] !== undefined) location[key] = req.body[key];
  }
  if (req.body.workspaceId !== undefined) {
    const currentWorkspaceId = String(location.workspace?._id || location.workspace || "");
    const nextWorkspaceId = String(req.body.workspaceId || "");
    if (currentWorkspaceId && currentWorkspaceId !== nextWorkspaceId &&
        await Project.exists({ workspace: currentWorkspaceId })) {
      throw new AppError("A location with projects cannot be moved to another workspace", 409);
    }
    if (req.body.workspaceId === null) {
      location.workspace = null;
    } else {
      await setLocationWorkspace(organization, location, req.body.workspaceId, req.user._id);
    }
  }
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const removeLocation = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:update");
  assertObjectId(req.params.locationId, "location id");
  const location = organization.locations.id(req.params.locationId);
  if (!location) throw new AppError("Location not found", 404);
  if (location.workspace && await Project.exists({ workspace: location.workspace })) {
    throw new AppError("A location with projects cannot be removed", 409);
  }
  organization.locations.pull({ _id: req.params.locationId });
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const listProposals = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:proposals");
  const proposals = await ProjectProposal.find({ organization: organization._id }).sort({ createdAt: -1 });
  res.json({ proposals: await Promise.all(proposals.map((proposal) => formatProposal(proposal, organization))) });
});

const createProposal = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:proposals");
  const proposal = await ProjectProposal.create({
    ...req.body,
    organization: organization._id,
    submittedBy: req.user._id,
  });
  const approvers = organization.members
    .filter((member) => member.role === "organization_admin")
    .map((member) => member.user);
  await notifyUsers(req.app.get("io"), approvers, {
    resource: organization,
    type: "project.proposal",
    title: `Project proposal needs your approval`,
    body: `${req.user.name} submitted “${proposal.name}” for ${proposal.clientName}`,
    link: "/app/organizations",
  });
  res.status(201).json({ proposal: await formatProposal(proposal, organization) });
});

const decideProposal = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:update");
  assertObjectId(req.params.proposalId, "proposal id");
  let proposal = await ProjectProposal.findOne({
    _id: req.params.proposalId,
    organization: organization._id,
  });
  if (!proposal) throw new AppError("Project proposal not found", 404);
  if (proposal.status !== "pending_ceo") {
    throw new AppError("This project proposal has already been decided", 409);
  }

  if (req.body.action === "reject") {
    proposal = await ProjectProposal.findOneAndUpdate(
      { _id: proposal._id, status: "pending_ceo" },
      { $set: { status: "rejected", decision: { action: "rejected", actor: req.user._id, note: req.body.note } } },
      { new: true, runValidators: true }
    );
    if (!proposal) throw new AppError("This project proposal has already been decided", 409);
    await notifyUsers(req.app.get("io"), [proposal.submittedBy], {
      resource: organization,
      type: "project.proposal",
      title: `Project proposal not approved`,
      body: `The proposal “${proposal.name}” was not approved${req.body.note ? `: ${req.body.note}` : "."}`,
      link: "/app/organizations",
    });
    return res.json({ proposal: await formatProposal(proposal, organization) });
  }

  const locationIds = [...new Set(req.body.locationIds)];
  if (locationIds.length !== req.body.locationIds.length) {
    throw new AppError("Choose each location only once", 400);
  }
  locationIds.forEach((id) => assertObjectId(id, "location id"));
  const locations = organization.locations.filter((location) =>
    locationIds.includes(String(location._id)) && location.workspace
  );
  if (locations.length !== locationIds.length) {
    throw new AppError("Every selected location must have a linked workspace", 400);
  }
  const workspaces = await Workspace.find({
    _id: { $in: locations.map((location) => location.workspace) },
    organizationId: organization._id,
  });
  if (workspaces.length !== locations.length) {
    throw new AppError("A selected location workspace is not linked to this organization", 400);
  }

  proposal = await ProjectProposal.findOneAndUpdate(
    { _id: proposal._id, status: "pending_ceo" },
    { $set: { status: "approving" } },
    { new: true }
  );
  if (!proposal) throw new AppError("This project proposal has already been decided", 409);

  let projects;
  try {
    projects = await Project.create(workspaces.map((workspace) => ({
    workspace: workspace._id,
    name: proposal.name,
    clientName: proposal.clientName,
    description: proposal.description,
    quotation: proposal.quotation,
    budget: proposal.quotation,
    currency: proposal.currency,
    startDate: proposal.startDate,
    dueDate: proposal.expectedCompletionDate,
    status: "active",
    workflowStage: "technical_review",
    owner: req.user._id,
    createdBy: proposal.submittedBy,
    proposal: proposal._id,
    })));
    proposal.status = "approved";
    proposal.locations = locationIds;
    proposal.projects = projects.map((project) => project._id);
    proposal.decision = { action: "approved", actor: req.user._id, note: req.body.note };
    await proposal.save();
  } catch (error) {
    await Project.deleteMany({ proposal: proposal._id });
    await ProjectProposal.updateOne(
    { _id: proposal._id, status: "approving" },
    { $set: { status: "pending_ceo", locations: [], projects: [], decision: null } }
    );
    throw error;
  }

  const io = req.app.get("io");
  for (const project of projects) {
    const workspace = workspaces.find((item) => String(item._id) === String(project.workspace));
    if (!workspace) continue;
    emitToWorkspace(io, workspace._id, "project:created", { project });
  }
  const recipients = new Set([String(proposal.submittedBy)]);
  workspaces.forEach((workspace) => workspace.members.forEach((member) => recipients.add(getMemberUserId(member))));
  await notifyUsers(io, [...recipients].filter((id) => id !== String(req.user._id)), {
    resource: organization,
    type: "project.proposal",
    title: `Project approved and assigned`,
    body: `“${proposal.name}” was approved and assigned to ${locations.filter((location) => locationIds.includes(String(location._id))).map((location) => location.name).join(", ")}.`,
    link: "/app/organizations",
  });
  res.json({ proposal: await formatProposal(proposal, organization) });
});

const inviteMember = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  const membership = await requireOrganizationPermission(organization, req.user, "organization:invite");
  const email = req.body.email.toLowerCase();
  const invitee = await User.findOne({ email }).select("name email");
  if (!invitee) throw new AppError("No account exists for that email", 404);
  if (organization.members.some((member) => getMemberUserId(member) === String(invitee._id))) {
    throw new AppError("User is already an organization member", 409);
  }
  if (req.body.role === "organization_admin" && req.user.platformRole !== "super_admin" && membership?.role !== "organization_admin") {
    throw new AppError("Only an organization administrator can invite another administrator", 403);
  }

  await OrganizationInvitation.updateMany(
    { organization: organization._id, email, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  const token = crypto.randomBytes(32).toString("hex");
  const invitation = await OrganizationInvitation.create({
    organization: organization._id,
    email,
    role: req.body.role,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    invitedBy: req.user._id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  await notifyUsers(req.app.get("io"), [invitee._id], {
    resource: organization,
    type: "organization.invite",
    title: `Invitation to ${organization.name}`,
    body: `${req.user.name} invited you to join as ${req.body.role.replace(/_/g, " ")}`,
    link: `/app/organizations?invite=${token}`,
  });
  res.status(201).json({ invitation: publicInvitation(invitation) });
});

const listInvitations = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:invite");
  const invitations = await OrganizationInvitation.find({
    organization: organization._id,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 }).select("-tokenHash");
  res.json({ invitations: invitations.map(publicInvitation) });
});

const revokeInvitation = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:invite");
  assertObjectId(req.params.invitationId, "invitation id");
  const invitation = await OrganizationInvitation.findOneAndUpdate(
    {
      _id: req.params.invitationId,
      organization: organization._id,
      acceptedAt: null,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!invitation) throw new AppError("Invitation not found", 404);
  res.json({ invitation: publicInvitation(invitation) });
});

const acceptInvitation = asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
  const now = new Date();
  const invitation = await OrganizationInvitation.findOne({ tokenHash }).select("+tokenHash");
  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new AppError("Invitation is invalid or has already been used", 404);
  }
  if (invitation.expiresAt <= now) throw new AppError("Invitation has expired", 410);
  if (invitation.email !== req.user.email.toLowerCase()) {
    throw new AppError("Sign in with the email address that received this invitation", 403);
  }

  const claimed = await OrganizationInvitation.findOneAndUpdate(
    { _id: invitation._id, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { acceptedAt: now } },
    { new: true }
  );
  if (!claimed) throw new AppError("Invitation is invalid or has already been used", 409);

  const result = await Organization.updateOne(
    { _id: invitation.organization, "members.user": { $ne: req.user._id } },
    { $push: { members: { user: req.user._id, role: invitation.role } } }
  );
  if (!result.modifiedCount) {
    await OrganizationInvitation.updateOne({ _id: invitation._id, acceptedAt: now }, { $set: { acceptedAt: null } });
    throw new AppError("You are already a member of this organization or it no longer exists", 409);
  }
  try {
    await createMembership({
      organizationId: invitation.organization,
      userId: req.user._id,
      role: invitation.role,
    });
  } catch (error) {
    await Organization.updateOne(
      { _id: invitation.organization },
      { $pull: { members: { user: req.user._id } } }
    );
    await OrganizationInvitation.updateOne({ _id: invitation._id, acceptedAt: now }, { $set: { acceptedAt: null } });
    throw error;
  }
  const organization = await loadOrganization(invitation.organization, req.user);
  res.json({ organization: await formatOrganization(organization) });
});

const updateMember = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  const actor = await requireOrganizationPermission(organization, req.user, "organization:members");
  assertObjectId(req.params.userId, "member id");
  const member = organization.members.find((item) => getMemberUserId(item) === req.params.userId);
  if (!member) throw new AppError("Member not found", 404);
  if (member.status && member.status !== "active") throw new AppError("Member is not active", 409);
  const membership = await findMembership(organization._id, req.params.userId);
  if (!membership || membership.status !== "active") throw new AppError("Member not found", 404);
  const changes = req.body;

  if (changes.role === "organization_admin" && req.user.platformRole !== "super_admin" && actor?.role !== "organization_admin") {
    throw new AppError("Only an organization administrator can assign that role", 403);
  }
  if (changes.department !== undefined && changes.department &&
      !organization.departments.some((department) => department.active && department.name === changes.department)) {
    throw new AppError("Choose an active department in this organization", 400);
  }
  const department = changes.department === undefined ? member.department : changes.department;
  const title = changes.title === undefined ? member.title : changes.title;
  if ((!department && title) || (department && title &&
      !organization.departments.find((item) => item.name === department)?.positions.includes(title))) {
    throw new AppError("Choose a position from the selected department", 400);
  }
  const nextRole = changes.role || member.role;
  await assertOwnerInvariant(organization._id, membership, nextRole);
  if (member.role === "organization_admin" && nextRole !== member.role) {
    const remainingAdmins = organization.members.filter((item) =>
      getMemberUserId(item) !== req.params.userId && item.role === "organization_admin"
    );
    if (!remainingAdmins.length) {
      throw new AppError("An organization must retain at least one administrator", 409);
    }
  }
  if (changes.role !== undefined) member.role = changes.role;
  if (changes.department !== undefined) member.department = changes.department;
  if (changes.title !== undefined || changes.department !== undefined) member.title = title || "";
  if (!member.department) member.title = "";
  if (!["team_lead", "organization_admin"].includes(member.role)) {
    organization.departments.forEach((item) => {
      if (String(item.manager) === req.params.userId) item.manager = null;
    });
  }
  if (changes.role !== undefined || changes.department !== undefined || changes.title !== undefined) {
    membership.role = nextRole;
    membership.department = member.department;
    membership.title = member.title;
    await membership.save();
  }
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const removeMember = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  const actor = await requireOrganizationPermission(organization, req.user, "organization:members");
  assertObjectId(req.params.userId, "member id");
  const target = organization.members.find((member) => getMemberUserId(member) === req.params.userId);
  if (!target) throw new AppError("Member not found", 404);
  const membership = await findMembership(organization._id, req.params.userId);
  if (!membership || membership.status !== "active") throw new AppError("Member not found", 404);
  await assertOwnerInvariant(organization._id, membership, membership.role, "revoked");
  if (membership.role === "organization_owner") throw new AppError("Transfer organization ownership before removing the owner", 409);
  if (target.role === "organization_admin") {
    const remainingAdmins = organization.members.filter((member) =>
      getMemberUserId(member) !== req.params.userId && member.role === "organization_admin"
    );
    if (!remainingAdmins.length) {
      throw new AppError("An organization must retain at least one administrator", 409);
    }
  }
  if (String(req.user._id) === req.params.userId && actor?.role === "organization_admin" &&
      !organization.members.some((member) => member.role === "organization_admin" && getMemberUserId(member) !== req.params.userId)) {
    throw new AppError("Assign another organization administrator before leaving", 409);
  }
  organization.members = organization.members.filter((member) => getMemberUserId(member) !== req.params.userId);
  organization.departments.forEach((department) => {
    if (String(department.manager) === req.params.userId) department.manager = null;
  });
  await organization.save();
  await OrganizationMembership.updateOne(
    { _id: membership._id, status: "active" },
    { $set: { status: "revoked", revokedAt: new Date() } }
  );
  res.json({ organization: await formatOrganization(organization) });
});

const createDepartment = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:departments");
  assertUniqueNames([req.body.name, ...organization.departments.map((department) => department.name)], "Department names");
  assertUniqueNames(req.body.positions, "Position names");
  organization.departments.push(req.body);
  await organization.save();
  res.status(201).json({ organization: await formatOrganization(organization) });
});

const updateDepartment = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:departments");
  assertObjectId(req.params.departmentId, "department id");
  const department = organization.departments.id(req.params.departmentId);
  if (!department) throw new AppError("Department not found", 404);
  if (req.body.managerId !== undefined && req.body.managerId !== null) {
    assertObjectId(req.body.managerId, "manager id");
    const manager = organization.members.find((member) => getMemberUserId(member) === req.body.managerId);
    if (!manager || !["team_lead", "organization_admin"].includes(manager.role)) {
      throw new AppError("A department manager must be an organization team lead or administrator", 400);
    }
    if (manager.department && manager.department !== department.name) {
      throw new AppError("Assign the manager to this department before making them its manager", 400);
    }
    manager.department = department.name;
  }
  if (req.body.positions !== undefined) {
    const membersWithRemovedPositions = organization.members.filter((member) =>
      member.department === department.name && member.title && !req.body.positions.includes(member.title)
    );
    if (membersWithRemovedPositions.length) {
      throw new AppError("Reassign department members before removing their positions", 409);
    }
    department.positions = req.body.positions;
  }
  if (req.body.description !== undefined) department.description = req.body.description;
  if (req.body.active !== undefined) department.active = req.body.active;
  if (req.body.managerId !== undefined) department.manager = req.body.managerId;
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const removeDepartment = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:departments");
  assertObjectId(req.params.departmentId, "department id");
  const department = organization.departments.id(req.params.departmentId);
  if (!department) throw new AppError("Department not found", 404);
  if (organization.members.some((member) => member.department === department.name)) {
    throw new AppError("Reassign department members before removing this department", 409);
  }
  const workspaces = await Workspace.find({ organizationId: organization._id }).select("_id");
  if (workspaces.length && await Project.exists({
    workspace: { $in: workspaces.map((workspace) => workspace._id) },
    "departmentAssignments.department": department.name,
  })) {
    throw new AppError("Remove this department from linked project assignments before deleting it", 409);
  }
  organization.departments.pull({ _id: department._id });
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

async function assertWorkspaceAdmin(workspace, userId, organization = null) {
  const member = workspace.members.find((item) => getMemberUserId(item) === String(userId));
  if (member && ["owner", "admin"].includes(member.role)) return;
  const companyOwner = organization
    ? organization.members.some((item) => getMemberUserId(item) === String(userId) && item.role === "organization_admin")
    : workspace.organizationId && await Organization.exists({
      _id: workspace.organizationId,
      members: { $elemMatch: { user: userId, role: "organization_admin" } },
    });
  if (!companyOwner) throw new AppError("Workspace owner, admin, or company owner access is required to link this workspace", 403);
}

const linkWorkspace = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:workspaces");
  assertObjectId(req.params.workspaceId, "workspace id");
  const workspace = await Workspace.findById(req.params.workspaceId);
  if (!workspace) throw new AppError("Workspace not found", 404);
  await assertWorkspaceAdmin(workspace, req.user._id, organization);
  if (workspace.organizationId && String(workspace.organizationId) !== String(organization._id)) {
    throw new AppError("Workspace is already linked to another organization", 409);
  }
  await assertSingleLocationMembership(organization, workspace);
  workspace.organizationId = organization._id;
  workspace.members.filter((member) => ["owner", "admin"].includes(member.role)).map(getMemberUserId).forEach((userId) => {
    if (userId && !organization.members.some((member) => getMemberUserId(member) === userId)) {
      organization.members.push({ user: userId, role: "viewer", status: "active" });
    }
  });
  await workspace.save();
  await organization.save();
  res.json({ organization: await formatOrganization(organization) });
});

const unlinkWorkspace = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:workspaces");
  assertObjectId(req.params.workspaceId, "workspace id");
  const workspace = await Workspace.findOne({ _id: req.params.workspaceId, organizationId: organization._id });
  if (!workspace) throw new AppError("Linked workspace not found", 404);
  await assertWorkspaceAdmin(workspace, req.user._id, organization);
  if (organization.locations.some((location) =>
    String(location.workspace?._id || location.workspace || "") === String(workspace._id)
  )) {
    throw new AppError("Unassign this workspace from its company location before unlinking it", 409);
  }
  workspace.organizationId = null;
  await workspace.save();
  res.json({ organization: await formatOrganization(organization) });
});

const workload = asyncHandler(async (req, res) => {
  const organization = await loadOrganization(req.params.id, req.user);
  await requireOrganizationPermission(organization, req.user, "organization:reports");
  const workspaces = await Workspace.find({ organizationId: organization._id }).select("_id");
  const workspaceIds = workspaces.map((workspace) => workspace._id);
  const projects = await Project.find({ workspace: { $in: workspaceIds } }).select("columns");
  const projectIds = projects.map((project) => project._id);
  const doneColumns = new Map(projects.map((project) => {
    const columns = [...project.columns].sort((a, b) => a.order - b.order);
    const done = columns.filter((column) => column.done);
    return [String(project._id), new Set((done.length ? done : [columns.find((column) => column.id === "done") || columns[columns.length - 1]])
      .filter(Boolean).map((column) => column.id))];
  }));
  const memberIds = organization.members.map((member) => member.user);
  const users = await User.find({ _id: { $in: memberIds } }).select("name email avatarColor lastSeenAt");
  const tasks = await Task.find({ project: { $in: projectIds }, assignees: { $in: memberIds } })
    .select("project columnId dueDate assignees")
    .lean();
  const stats = new Map(users.map((user) => [String(user._id), { pending: 0, completed: 0, overdue: 0 }]));
  const now = Date.now();
  for (const task of tasks) {
    const done = doneColumns.get(String(task.project))?.has(task.columnId) || false;
    for (const assignee of task.assignees) {
      const item = stats.get(String(assignee));
      if (!item) continue;
      if (done) item.completed += 1;
      else {
        item.pending += 1;
        if (task.dueDate && new Date(task.dueDate).getTime() < now) item.overdue += 1;
      }
    }
  }
  const totalPending = [...stats.values()].reduce((sum, item) => sum + item.pending, 0);
  const capacity = organization.settings?.defaultTaskCapacity || 10;
  const workload = organization.members.map((member) => {
    const user = users.find((item) => String(item._id) === getMemberUserId(member));
    if (!user) return null;
    const item = stats.get(String(user._id));
    return {
      user,
      role: member.role,
      department: member.department,
      ...item,
      workloadShare: totalPending ? Math.round((item.pending / totalPending) * 100) : 0,
      capacityPercent: Math.round((item.pending / capacity) * 100),
      online: isOnline(user._id),
    };
  }).filter(Boolean);
  res.json({ workload, capacityPerMember: capacity, workspaceCount: workspaceIds.length });
});

module.exports = {
  createSchema,
  updateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  locationDeleteSchema,
  proposalCreateSchema,
  proposalDecisionSchema,
  inviteSchema,
  acceptInvitationSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  memberUpdateSchema,
  workspaceLinkSchema,
  list,
  create,
  getOne,
  update,
  createLocation,
  updateLocation,
  removeLocation,
  listProposals,
  createProposal,
  decideProposal,
  inviteMember,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
  updateMember,
  removeMember,
  createDepartment,
  updateDepartment,
  removeDepartment,
  linkWorkspace,
  unlinkWorkspace,
  workload,
};
