const request = require("supertest");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");
const OrganizationInvitation = require("../src/models/OrganizationInvitation");
const Notification = require("../src/models/Notification");
const Project = require("../src/models/Project");
const Task = require("../src/models/Task");
const User = require("../src/models/User");

describe("organizations", () => {
  let app;

  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);
  beforeEach(clearDb);

  async function createOrganization(cookie, name = "Acme") {
    return request(app)
      .post("/api/organizations")
      .set("Cookie", cookie)
      .send({ name, description: `${name} team`, website: "https://example.com" });
  }

  async function invitationToken(userId) {
    const notification = await Notification.findOne({ user: userId, type: "organization.invite" }).sort({ createdAt: -1 });
    expect(notification).toBeTruthy();
    return new URL(notification.link, "http://localhost").searchParams.get("invite");
  }

  test("organization membership and profile permissions are isolated", async () => {
    const ownerRes = await register(app, { email: "org-owner@example.com", name: "Org owner" });
    const strangerRes = await register(app, { email: "org-stranger@example.com", name: "Stranger" });
    const owner = ownerRes.headers["set-cookie"][0];
    const stranger = strangerRes.headers["set-cookie"][0];
    const created = await createOrganization(owner);
    const organizationId = created.body.organization._id;

    expect(created.status).toBe(201);
    expect(created.body.organization.members[0]).toMatchObject({
      role: "organization_admin",
      user: { email: "org-owner@example.com" },
    });
    expect((await request(app).get(`/api/organizations/${organizationId}`).set("Cookie", owner)).status).toBe(200);
    expect((await request(app).get(`/api/organizations/${organizationId}`).set("Cookie", stranger)).status).toBe(403);
    expect((await request(app).patch(`/api/organizations/${organizationId}`).set("Cookie", stranger).send({ name: "Hijacked" })).status).toBe(403);
    expect((await request(app).get("/api/organizations").set("Cookie", stranger)).body.organizations).toHaveLength(0);
  });

  test("organization admins can maintain unique company locations and members can view them", async () => {
    const adminRes = await register(app, { email: "location-admin@example.com", name: "Admin" });
    const memberRes = await register(app, { email: "location-member@example.com", name: "Member" });
    const admin = adminRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];
    const workspace = await request(app).post("/api/workspaces").set("Cookie", admin).send({ name: "Location workspace" });
    const created = await createOrganization(admin, "Kyro Technologies");
    const organizationId = created.body.organization._id;
    await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", admin)
      .send({ email: "location-member@example.com", role: "viewer" });
    const token = await invitationToken(memberRes.body.user._id);
    await request(app).post("/api/organizations/invitations/accept").set("Cookie", member).send({ token });

    const added = await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", admin)
      .send({
        name: "Bengaluru Office",
        address: "100 Example Road, Bengaluru",
        contactName: "Office Manager",
        contactEmail: "office@example.com",
        contactPhone: "+91 80 5555 0100",
        workspaceId: workspace.body.workspace._id,
      });
    expect(added.status).toBe(201);
    const location = added.body.organization.locations[0];
    expect(location).toMatchObject({
      name: "Bengaluru Office",
      address: "100 Example Road, Bengaluru",
      contactEmail: "office@example.com",
    });
    expect(location.workspace.name).toBe("Location workspace");
    expect((await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", admin)
      .send({ name: "bengaluru office", address: "Another address" })).status).toBe(400);

    const updated = await request(app).patch(`/api/organizations/${organizationId}/locations/${location._id}`).set("Cookie", admin)
      .send({ address: "101 Example Road, Bengaluru" });
    expect(updated.status).toBe(200);
    expect(updated.body.organization.locations[0].address).toBe("101 Example Road, Bengaluru");
    const visible = await request(app).get(`/api/organizations/${organizationId}`).set("Cookie", member);
    expect(visible.body.organization.locations[0].name).toBe("Bengaluru Office");
    expect((await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", member)
      .send({ name: "Pune Office", address: "200 Example Road, Pune" })).status).toBe(403);
    expect((await request(app).delete(`/api/organizations/${organizationId}/locations/${location._id}`).set("Cookie", admin)).status).toBe(200);
    expect((await request(app).get(`/api/organizations/${organizationId}`).set("Cookie", admin)).body.organization.locations).toHaveLength(0);
  });

  test("business proposals require CEO approval and create separate location projects", async () => {
    const ceoRes = await register(app, { email: "proposal-ceo@example.com", name: "CEO" });
    const businessRes = await register(app, { email: "business-team@example.com", name: "Business Team" });
    const locationOwnerRes = await register(app, { email: "location-owner@example.com", name: "Location Owner" });
    const secondLocationOwnerRes = await register(app, { email: "second-location-owner@example.com", name: "Second Location Owner" });
    const branchMemberRes = await register(app, { email: "branch-member@example.com", name: "Branch Member" });
    const ceo = ceoRes.headers["set-cookie"][0];
    const business = businessRes.headers["set-cookie"][0];
    const locationOwner = locationOwnerRes.headers["set-cookie"][0];
    const secondLocationOwner = secondLocationOwnerRes.headers["set-cookie"][0];
    const branchMember = branchMemberRes.headers["set-cookie"][0];
    const organization = await createOrganization(ceo, "Kyro Projects");
    const organizationId = organization.body.organization._id;

    const bengaluruWorkspace = await request(app).post("/api/workspaces").set("Cookie", locationOwner)
      .send({ name: "Bengaluru" });
    const puneWorkspace = await request(app).post("/api/workspaces").set("Cookie", secondLocationOwner)
      .send({ name: "Pune" });
    for (const workspace of [bengaluruWorkspace, puneWorkspace]) {
      expect((await request(app).put(`/api/organizations/${organizationId}/workspaces/${workspace.body.workspace._id}`)
        .set("Cookie", ceo)).status).toBe(200);
    }

    const bengaluruLocation = await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", ceo)
      .send({ name: "Bengaluru", address: "Bengaluru, India", workspaceId: bengaluruWorkspace.body.workspace._id });
    const puneLocation = await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", ceo)
      .send({ name: "Pune", address: "Pune, India", workspaceId: puneWorkspace.body.workspace._id });
    expect(bengaluruLocation.status).toBe(201);
    expect(puneLocation.status).toBe(201);
    expect((await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", ceo)
      .send({ name: "Duplicate workspace", address: "Somewhere", workspaceId: bengaluruWorkspace.body.workspace._id })).status).toBe(409);

    await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", ceo)
      .send({ email: "business-team@example.com", role: "business_management" });
    const token = await invitationToken(businessRes.body.user._id);
    expect((await request(app).post("/api/organizations/invitations/accept").set("Cookie", business).send({ token })).status).toBe(200);

    const teamInvite = await request(app).post(`/api/workspaces/${bengaluruWorkspace.body.workspace._id}/invites`)
      .set("Cookie", locationOwner)
      .send({ email: "branch-member@example.com", role: "react_developer" });
    expect(teamInvite.status).toBe(200);
    const duplicateLocationInvite = await request(app).post(`/api/workspaces/${puneWorkspace.body.workspace._id}/invites`)
      .set("Cookie", secondLocationOwner)
      .send({ email: "branch-member@example.com", role: "react_developer" });
    expect(duplicateLocationInvite.status).toBe(409);

    const proposal = await request(app).post(`/api/organizations/${organizationId}/proposals`).set("Cookie", business)
      .send({
        name: "Client portal",
        clientName: "Example Client",
        description: "Build a secure client portal.",
        quotation: 250000,
        currency: "INR",
        startDate: "2026-12-01T00:00:00.000Z",
        expectedCompletionDate: "2027-03-01T00:00:00.000Z",
      });
    expect(proposal.status).toBe(201);
    expect((await request(app).post(`/api/organizations/${organizationId}/proposals/${proposal.body.proposal._id}/decision`)
      .set("Cookie", business).send({ action: "approve", locationIds: [bengaluruLocation.body.organization.locations[0]._id] })).status).toBe(403);

    const directProject = await request(app).post(`/api/workspaces/${bengaluruWorkspace.body.workspace._id}/projects`)
      .set("Cookie", locationOwner)
      .send({ name: "Unapproved project" });
    expect(directProject.status).toBe(403);

    const approved = await request(app).post(`/api/organizations/${organizationId}/proposals/${proposal.body.proposal._id}/decision`)
      .set("Cookie", ceo)
      .send({
        action: "approve",
        locationIds: [
          bengaluruLocation.body.organization.locations[0]._id,
          puneLocation.body.organization.locations.find((location) => location.name === "Pune")._id,
        ],
        note: "Approved for both branches",
      });
    expect(approved.status).toBe(200);
    expect(approved.body.proposal.projects).toHaveLength(2);
    expect(approved.body.proposal.projects.map((project) => String(project.workspace))).toEqual(expect.arrayContaining([
      bengaluruWorkspace.body.workspace._id,
      puneWorkspace.body.workspace._id,
    ]));
    for (const project of approved.body.proposal.projects) {
      expect(project).toMatchObject({ workflowStage: "technical_review" });
    }
    const ceoBoard = await request(app).get(`/api/projects/${approved.body.proposal.projects[0]._id}`).set("Cookie", ceo);
    expect(ceoBoard.status).toBe(200);
    expect(ceoBoard.body.project).toMatchObject({ clientName: "Example Client", quotation: 250000, currency: "INR" });
    expect(ceoBoard.body.myRole).toBe("viewer");
    expect((await request(app).post(`/api/projects/${approved.body.proposal.projects[0]._id}/tasks`)
      .set("Cookie", ceo).send({ title: "CEO cannot edit location board" })).status).toBe(403);
    const otherLocationBoard = await request(app).get(`/api/projects/${approved.body.proposal.projects.find((project) =>
      String(project.workspace) === String(puneWorkspace.body.workspace._id)
    )._id}`).set("Cookie", branchMember);
    expect(otherLocationBoard.status).toBe(403);
    expect((await request(app).get(`/api/projects/${approved.body.proposal.projects[0]._id}`).set("Cookie", business)).status).toBe(403);
    const ceoWorkspaces = await request(app).get("/api/workspaces").set("Cookie", ceo);
    expect(ceoWorkspaces.body.workspaces.map((workspace) => workspace.name)).toEqual(expect.arrayContaining(["Bengaluru", "Pune"]));
  });

  test("location team leads can add and remove only members of their own role group", async () => {
    const ownerRes = await register(app, { email: "team-lead-owner@example.com", name: "Owner" });
    const leadRes = await register(app, { email: "location-dev-lead@example.com", name: "Development Lead" });
    const developerRes = await register(app, { email: "location-developer@example.com", name: "Developer" });
    const owner = ownerRes.headers["set-cookie"][0];
    const lead = leadRes.headers["set-cookie"][0];
    const workspace = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Lead location" });
    const workspaceId = workspace.body.workspace._id;
    await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", owner)
      .send({ email: "location-dev-lead@example.com", role: "development_team_lead" });

    const added = await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", lead)
      .send({ email: "location-developer@example.com", role: "react_developer" });
    expect(added.status).toBe(200);
    const forbiddenRole = await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", lead)
      .send({ email: "team-lead-owner@example.com", role: "qa_engineer" });
    expect(forbiddenRole.status).toBe(403);
    expect((await request(app).delete(`/api/workspaces/${workspaceId}/members/${developerRes.body.user._id}`).set("Cookie", lead)).status).toBe(200);
  });

  test("organization invitations are email-bound, expiring, and single-use", async () => {
    const adminRes = await register(app, { email: "invite-admin@example.com", name: "Admin" });
    const inviteeRes = await register(app, { email: "invitee@example.com", name: "Invitee" });
    const wrongUserRes = await register(app, { email: "wrong-user@example.com", name: "Wrong user" });
    const admin = adminRes.headers["set-cookie"][0];
    const invitee = inviteeRes.headers["set-cookie"][0];
    const wrongUser = wrongUserRes.headers["set-cookie"][0];
    const organization = await createOrganization(admin);
    const id = organization.body.organization._id;

    const invited = await request(app)
      .post(`/api/organizations/${id}/invitations`)
      .set("Cookie", admin)
      .send({ email: "invitee@example.com", role: "developer" });
    expect(invited.status).toBe(201);
    const token = await invitationToken(inviteeRes.body.user._id);
    expect((await request(app).post("/api/organizations/invitations/accept").set("Cookie", wrongUser).send({ token })).status).toBe(403);

    const accepted = await request(app)
      .post("/api/organizations/invitations/accept")
      .set("Cookie", invitee)
      .send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.organization.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "developer", user: expect.objectContaining({ email: "invitee@example.com" }) }),
    ]));
    expect((await request(app).post("/api/organizations/invitations/accept").set("Cookie", invitee).send({ token })).status).toBe(404);

    const expiring = await request(app)
      .post(`/api/organizations/${id}/invitations`)
      .set("Cookie", admin)
      .send({ email: "wrong-user@example.com", role: "viewer" });
    const expiredToken = await invitationToken(wrongUserRes.body.user._id);
    await OrganizationInvitation.findByIdAndUpdate(expiring.body.invitation.id, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await request(app)
      .post("/api/organizations/invitations/accept")
      .set("Cookie", wrongUser)
      .send({ token: expiredToken });
    expect(expired.status).toBe(410);
  });

  test("department management validates organization membership and department ownership", async () => {
    const adminRes = await register(app, { email: "dept-admin@example.com", name: "Admin" });
    const leadRes = await register(app, { email: "dept-lead@example.com", name: "Lead" });
    const admin = adminRes.headers["set-cookie"][0];
    const lead = leadRes.headers["set-cookie"][0];
    const organization = await createOrganization(admin);
    const id = organization.body.organization._id;
    await request(app).post(`/api/organizations/${id}/invitations`).set("Cookie", admin)
      .send({ email: "dept-lead@example.com", role: "team_lead" });
    const token = await invitationToken(leadRes.body.user._id);
    await request(app).post("/api/organizations/invitations/accept").set("Cookie", lead).send({ token });

    const departmentResponse = await request(app).post(`/api/organizations/${id}/departments`).set("Cookie", admin)
      .send({ name: "Product Research", positions: ["Lead", "Analyst"] });
    expect(departmentResponse.status).toBe(201);
    const department = departmentResponse.body.organization.departments.find((item) => item.name === "Product Research");
    const assigned = await request(app).patch(`/api/organizations/${id}/members/${leadRes.body.user._id}`).set("Cookie", admin)
      .send({ department: "Product Research", title: "Lead" });
    expect(assigned.status).toBe(200);
    const managed = await request(app).patch(`/api/organizations/${id}/departments/${department._id}`).set("Cookie", admin)
      .send({ managerId: leadRes.body.user._id });
    expect(managed.status).toBe(200);
    expect(managed.body.organization.departments.find((item) => item._id === department._id).manager.email).toBe("dept-lead@example.com");
    expect((await request(app).delete(`/api/organizations/${id}/departments/${department._id}`).set("Cookie", admin)).status).toBe(409);
    expect((await request(app).post(`/api/organizations/${id}/departments`).set("Cookie", lead)
      .send({ name: "Unauthorized", positions: [] })).status).toBe(403);
  });

  test("organization project managers create assigned projects and workload stays within linked workspaces", async () => {
    const adminRes = await register(app, { email: "workload-admin@example.com", name: "Admin" });
    const managerRes = await register(app, { email: "workload-pm@example.com", name: "Manager" });
    const businessRes = await register(app, { email: "workload-business@example.com", name: "Business Team" });
    const outsiderRes = await register(app, { email: "workload-outsider@example.com", name: "Outsider" });
    const admin = adminRes.headers["set-cookie"][0];
    const manager = managerRes.headers["set-cookie"][0];
    const business = businessRes.headers["set-cookie"][0];
    const outsider = outsiderRes.headers["set-cookie"][0];
    const organization = await createOrganization(admin);
    const organizationId = organization.body.organization._id;
    await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", admin)
      .send({ email: "workload-pm@example.com", role: "project_manager" });
    const token = await invitationToken(managerRes.body.user._id);
    await request(app).post("/api/organizations/invitations/accept").set("Cookie", manager).send({ token });
    await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", admin)
      .send({ email: "workload-business@example.com", role: "business_management" });
    const businessToken = await invitationToken(businessRes.body.user._id);
    await request(app).post("/api/organizations/invitations/accept").set("Cookie", business).send({ token: businessToken });

    const workspace = await request(app).post("/api/workspaces").set("Cookie", admin).send({ name: "Org project space" });
    const workspaceId = workspace.body.workspace._id;
    expect((await request(app).put(`/api/organizations/${organizationId}/workspaces/${workspaceId}`).set("Cookie", admin)).status).toBe(200);
    const location = await request(app).post(`/api/organizations/${organizationId}/locations`).set("Cookie", admin)
      .send({ name: "Workload location", address: "Office address", workspaceId });
    expect(location.status).toBe(201);
    await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", admin)
      .send({ email: "workload-pm@example.com", role: "member" });

    const projectResponse = await request(app).post(`/api/organizations/${organizationId}/proposals`).set("Cookie", business)
      .send({
        name: "PM project",
        clientName: "Workload client",
        description: "Workload test project",
        quotation: 1000,
        currency: "INR",
        startDate: new Date().toISOString(),
        expectedCompletionDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(projectResponse.status).toBe(201);
    const assigned = await request(app).post(`/api/organizations/${organizationId}/proposals/${projectResponse.body.proposal._id}/decision`)
      .set("Cookie", admin)
      .send({ action: "approve", locationIds: [location.body.organization.locations[0]._id] });
    expect(assigned.status).toBe(200);
    const projectId = assigned.body.proposal.projects[0]._id;
    expect((await request(app).patch(`/api/projects/${projectId}`).set("Cookie", admin)
      .send({ projectManagerId: managerRes.body.user._id })).status).toBe(200);
    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", manager)).status).toBe(200);
    await Task.create({
      workspace: workspaceId,
      project: projectId,
      title: "Overdue PM task",
      columnId: "todo",
      dueDate: new Date(Date.now() - 60_000),
      assignees: [managerRes.body.user._id],
      createdBy: adminRes.body.user._id,
    });

    const workload = await request(app).get(`/api/organizations/${organizationId}/workload`).set("Cookie", admin);
    expect(workload.status).toBe(200);
    expect(workload.body.workspaceCount).toBe(1);
    expect(workload.body.workload.find((item) => item.user.email === "workload-pm@example.com"))
      .toMatchObject({ pending: 1, overdue: 1, completed: 0 });
    expect((await request(app).get(`/api/organizations/${organizationId}/workload`).set("Cookie", outsider)).status).toBe(403);
  });

  test("organization team leads manage assigned teams and developers can edit assigned project tasks", async () => {
    const adminRes = await register(app, { email: "team-admin@example.com", name: "Admin" });
    const leadRes = await register(app, { email: "team-lead@example.com", name: "Lead" });
    const developerRes = await register(app, { email: "team-developer@example.com", name: "Developer" });
    const admin = adminRes.headers["set-cookie"][0];
    const lead = leadRes.headers["set-cookie"][0];
    const developer = developerRes.headers["set-cookie"][0];
    const organization = await createOrganization(admin, "Team Org");
    const organizationId = organization.body.organization._id;

    for (const [email, cookie, role, userId] of [
      ["team-lead@example.com", lead, "team_lead", leadRes.body.user._id],
      ["team-developer@example.com", developer, "developer", developerRes.body.user._id],
    ]) {
      await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", admin).send({ email, role });
      const token = await invitationToken(userId);
      expect((await request(app).post("/api/organizations/invitations/accept").set("Cookie", cookie).send({ token })).status).toBe(200);
      expect((await request(app).patch(`/api/organizations/${organizationId}/members/${userId}`).set("Cookie", admin)
        .send({ department: "Development Department" })).status).toBe(200);
    }

    const workspace = await request(app).post("/api/workspaces").set("Cookie", admin).send({ name: "Team workspace" });
    const workspaceId = workspace.body.workspace._id;
    await request(app).put(`/api/organizations/${organizationId}/workspaces/${workspaceId}`).set("Cookie", admin);
    for (const email of ["team-lead@example.com", "team-developer@example.com"]) {
      expect((await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", admin)
        .send({ email, role: "member" })).status).toBe(200);
    }

    const project = await Project.create({
      workspace: workspaceId,
      name: "Organization team project",
      workflowStage: "development",
      owner: adminRes.body.user._id,
      createdBy: adminRes.body.user._id,
    });
    project.departmentAssignments = [{
      department: "Development Department",
      teamLead: leadRes.body.user._id,
      members: [],
    }];
    await project.save();

    const leadBoard = await request(app).get(`/api/projects/${project.id}`).set("Cookie", lead);
    expect(leadBoard.status).toBe(200);
    expect(leadBoard.body.canEditTasks).toBe(true);
    expect(leadBoard.body.organizationMembers.map((member) => member.role)).toEqual(expect.arrayContaining(["team_lead", "developer"]));
    expect(leadBoard.body.organizationDepartments.map((department) => department.name)).toContain("Development Department");

    const added = await request(app).post(`/api/projects/${project.id}/team-members`).set("Cookie", lead)
      .send({ department: "Development Department", memberIds: [developerRes.body.user._id] });
    expect(added.status).toBe(200);
    const developerBoard = await request(app).get(`/api/projects/${project.id}`).set("Cookie", developer);
    expect(developerBoard.status).toBe(200);
    expect(developerBoard.body.canEditTasks).toBe(true);
    const task = await request(app).post(`/api/projects/${project.id}/tasks`).set("Cookie", developer)
      .send({ title: "Organization-assigned task" });
    expect(task.status).toBe(201);
  });

  test("Super Admin access is platform-scoped and cannot be granted by organization requests", async () => {
    const adminRes = await register(app, { email: "regular-admin@example.com", name: "Admin" });
    const superRes = await register(app, { email: "platform-admin@example.com", name: "Platform Admin" });
    const admin = adminRes.headers["set-cookie"][0];
    const superAdmin = superRes.headers["set-cookie"][0];
    await User.findByIdAndUpdate(superRes.body.user._id, { platformRole: "super_admin" });
    const organization = await createOrganization(admin);
    const organizationId = organization.body.organization._id;

    expect((await request(app).get(`/api/organizations/${organizationId}`).set("Cookie", superAdmin)).status).toBe(200);
    expect((await request(app).get("/api/organizations").set("Cookie", superAdmin)).body.organizations).toHaveLength(1);
    const deniedRole = await request(app).post(`/api/organizations/${organizationId}/invitations`).set("Cookie", admin)
      .send({ email: "platform-admin@example.com", role: "super_admin" });
    expect(deniedRole.status).toBe(400);
  });
});
