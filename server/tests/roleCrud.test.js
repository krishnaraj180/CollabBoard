const request = require("supertest");
const mongoose = require("mongoose");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");
const Organization = require("../src/models/Organization");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const Role = require("../src/models/Role");

describe("custom organization roles", () => {
  let app;

  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);
  beforeEach(clearDb);

  async function createOrganization(cookie, name) {
    return request(app).post("/api/organizations").set("Cookie", cookie).send({ name });
  }

  async function addMember(organizationId, userId, role = "viewer") {
    const organization = await Organization.findById(organizationId);
    organization.members.push({ user: userId, role, status: "active" });
    await organization.save();
    return OrganizationMembership.create({ organizationId, userId, role, status: "active" });
  }

  test("CRUD is tenant-scoped, names are tenant-local, and system roles are read-only", async () => {
    const ownerA = await register(app, { email: "role-owner-a@example.com" });
    const ownerB = await register(app, { email: "role-owner-b@example.com" });
    const cookieA = ownerA.headers["set-cookie"][0];
    const cookieB = ownerB.headers["set-cookie"][0];
    const orgA = (await createOrganization(cookieA, "Role Org A")).body.organization._id;
    const orgB = (await createOrganization(cookieB, "Role Org B")).body.organization._id;

    const createA = await request(app).post(`/api/organizations/${orgA}/roles`).set("Cookie", cookieA).send({
      name: "Analyst", permissions: ["organization:read"], organizationId: orgB,
    });
    expect(createA.status).toBe(400);
    const roleA = await request(app).post(`/api/organizations/${orgA}/roles`).set("Cookie", cookieA)
      .send({ name: "Analyst", permissions: ["organization:read"] });
    expect(roleA.status).toBe(201);
    expect(roleA.body.role.key).toMatch(/^analyst_[a-f0-9]{8}$/);
    expect((await request(app).post(`/api/organizations/${orgA}/roles`).set("Cookie", cookieA)
      .send({ name: "Unknown", permissions: ["not:a:permission"] })).status).toBe(400);
    const roleB = await request(app).post(`/api/organizations/${orgB}/roles`).set("Cookie", cookieB)
      .send({ name: "Analyst", permissions: ["organization:read"] });
    expect(roleB.status).toBe(201);
    expect((await request(app).get(`/api/organizations/${orgA}/roles`).set("Cookie", cookieB)).status).toBe(404);
    const edited = await request(app).patch(`/api/organizations/${orgA}/roles/${roleA.body.role._id}`).set("Cookie", cookieA)
      .send({ name: "Senior Analyst" });
    expect(edited.status).toBe(200);
    const systemRole = await Role.findOne({ organizationId: orgA, isSystem: true });
    expect((await request(app).patch(`/api/organizations/${orgA}/roles/${systemRole._id}`).set("Cookie", cookieA)
      .send({ name: "Changed" })).status).toBe(403);
  });

  test("permission escalation and assignment are rejected, and removal applies next request", async () => {
    const owner = await register(app, { email: "role-owner@example.com" });
    const member = await register(app, { email: "role-member@example.com" });
    const admin = await register(app, { email: "role-admin@example.com" });
    const ownerCookie = owner.headers["set-cookie"][0];
    const memberCookie = member.headers["set-cookie"][0];
    const adminCookie = admin.headers["set-cookie"][0];
    const organizationId = (await createOrganization(ownerCookie, "Escalation Org")).body.organization._id;
    const limited = await request(app).post(`/api/organizations/${organizationId}/roles`).set("Cookie", ownerCookie)
      .send({ name: "Limited", permissions: ["organization:read"] });
    expect(limited.status).toBe(201);
    const adminMembership = await addMember(organizationId, admin.body.user._id, "organization_admin");
    const adminRole = await Role.findOne({ organizationId, key: "admin" });
    adminMembership.roleId = adminRole._id;
    await adminMembership.save();
    expect((await request(app).post(`/api/organizations/${organizationId}/roles`).set("Cookie", adminCookie)
      .send({ name: "Role Manager", permissions: ["org.manage_roles"] })).status).toBe(403);
    expect((await request(app).post(`/api/organizations/${organizationId}/roles`).set("Cookie", adminCookie)
      .send({ name: "Too Powerful", permissions: ["workspace:delete"] })).status).toBe(403);
    await addMember(organizationId, member.body.user._id);
    const assigned = await request(app).put(`/api/organizations/${organizationId}/members/${member.body.user._id}/role`)
      .set("Cookie", ownerCookie).send({ roleId: limited.body.role._id });
    expect(assigned.status).toBe(200);
    expect((await request(app).put(`/api/organizations/${organizationId}/members/${owner.body.user._id}/role`)
      .set("Cookie", ownerCookie).send({ roleId: limited.body.role._id })).status).toBe(409);
    expect((await request(app).get(`/api/organizations/${organizationId}/roles`).set("Cookie", memberCookie)).status).toBe(403);
    expect((await request(app).patch(`/api/organizations/${organizationId}/roles/${limited.body.role._id}`).set("Cookie", ownerCookie)
      .send({ permissions: [] })).status).toBe(200);
    expect((await request(app).get(`/api/organizations/${organizationId}/roles`).set("Cookie", memberCookie)).status).toBe(403);
    expect((await request(app).delete(`/api/organizations/${organizationId}/members/${owner.body.user._id}`).set("Cookie", ownerCookie)).status).toBe(409);
    expect((await request(app).delete(`/api/organizations/${organizationId}/roles/${limited.body.role._id}`).set("Cookie", ownerCookie).send({})).status).toBe(409);
    const viewerRole = await Role.findOne({ organizationId, key: "viewer" });
    const reassigned = await request(app).delete(`/api/organizations/${organizationId}/roles/${limited.body.role._id}`).set("Cookie", ownerCookie)
      .send({ reassignRoleId: viewerRole._id });
    expect(reassigned.status).toBe(204);
    expect(await Role.exists({ _id: limited.body.role._id })).toBeFalsy();
    expect((await request(app).get(`/api/organizations/${organizationId}/roles`).set("Cookie", memberCookie)).status).toBe(403);
  });

  test("a user without org.manage_roles cannot list or assign roles", async () => {
    const owner = await register(app, { email: "permission-owner@example.com" });
    const member = await register(app, { email: "permission-member@example.com" });
    const ownerCookie = owner.headers["set-cookie"][0];
    const memberCookie = member.headers["set-cookie"][0];
    const organizationId = (await createOrganization(ownerCookie, "Permission Org")).body.organization._id;
    await addMember(organizationId, member.body.user._id);
    expect((await request(app).get(`/api/organizations/${organizationId}/roles`).set("Cookie", memberCookie)).status).toBe(403);
    expect((await request(app).put(`/api/organizations/${organizationId}/members/${owner.body.user._id}/role`)
      .set("Cookie", memberCookie).send({ roleId: new mongoose.Types.ObjectId() })).status).toBe(403);
  });
});
