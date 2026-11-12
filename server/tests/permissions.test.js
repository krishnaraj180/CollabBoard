const request = require("supertest");
const fs = require("fs");
const { startDb, stopDb, clearDb, createTestApp, register, advanceProjectToDevelopment } = require("./helpers");
const { dest } = require("../src/middleware/upload");
const Message = require("../src/models/Message");

describe("permissions", () => {
  let app;

  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);
  beforeEach(clearDb);

  test("unauthorized requests are rejected", async () => {
    const res = await request(app).get("/api/workspaces");
    expect(res.status).toBe(401);
  });

  test("CEOs manage all locations while MDs can only be assigned to one location", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const ceoRes = await register(app, { email: "ceo@example.com", name: "CEO" });
    const otherCeoRes = await register(app, { email: "other-ceo@example.com", name: "Other CEO" });
    const mdRes = await register(app, { email: "md@example.com", name: "Chennai MD" });
    const otherMdRes = await register(app, { email: "other-md@example.com", name: "Mumbai MD" });
    const staffRes = await register(app, { email: "staff@example.com", name: "Staff" });
    await register(app, { email: "new-staff@example.com", name: "New Staff" });
    const owner = ownerRes.headers["set-cookie"][0];
    const ceo = ceoRes.headers["set-cookie"][0];
    const otherCeo = otherCeoRes.headers["set-cookie"][0];
    const md = mdRes.headers["set-cookie"][0];

    const chennai = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Chennai" });
    const mumbai = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Mumbai" });
    const chennaiId = chennai.body.workspace._id;
    const mumbaiId = mumbai.body.workspace._id;
    for (const [workspaceId, email, role] of [
      [chennaiId, "ceo@example.com", "ceo"],
      [chennaiId, "md@example.com", "member"],
      [mumbaiId, "ceo@example.com", "ceo"],
      [mumbaiId, "other-md@example.com", "managing_director"],
      [chennaiId, "staff@example.com", "member"],
    ]) {
      const invited = await request(app)
        .post(`/api/workspaces/${workspaceId}/invites`)
        .set("Cookie", owner)
        .send({ email, role });
      expect(invited.status).toBe(200);
    }

    const appointedDirector = await request(app)
      .patch(`/api/workspaces/${chennaiId}/members/${mdRes.body.user._id}`)
      .set("Cookie", ceo)
      .send({ role: "managing_director" });
    expect(appointedDirector.status).toBe(200);
    const duplicateDirector = await request(app)
      .post(`/api/workspaces/${mumbaiId}/invites`)
      .set("Cookie", owner)
      .send({ email: "md@example.com", role: "managing_director" });
    expect(duplicateDirector.status).toBe(409);
    const duplicateLocationMembership = await request(app)
      .post(`/api/workspaces/${mumbaiId}/invites`)
      .set("Cookie", owner)
      .send({ email: "md@example.com", role: "member" });
    expect(duplicateLocationMembership.status).toBe(409);
    const secondDirectorAtLocation = await request(app)
      .post(`/api/workspaces/${chennaiId}/invites`)
      .set("Cookie", owner)
      .send({ email: "other-md@example.com", role: "managing_director" });
    expect(secondDirectorAtLocation.status).toBe(409);
    const secondCompanyCeo = await request(app)
      .post(`/api/workspaces/${mumbaiId}/invites`)
      .set("Cookie", owner)
      .send({ email: "other-ceo@example.com", role: "ceo" });
    expect(secondCompanyCeo.status).toBe(409);

    const assigned = await request(app)
      .patch(`/api/workspaces/${chennaiId}/members/${mdRes.body.user._id}/organization`)
      .set("Cookie", owner)
      .send({ department: "", title: "", reportsTo: ceoRes.body.user._id });
    expect(assigned.status).toBe(200);
    await request(app)
      .patch(`/api/workspaces/${mumbaiId}/members/${otherMdRes.body.user._id}/organization`)
      .set("Cookie", owner)
      .send({ department: "", title: "", reportsTo: ceoRes.body.user._id });

    const ceoWorkspaces = await request(app).get("/api/workspaces").set("Cookie", ceo);
    expect(ceoWorkspaces.body.workspaces.map((workspace) => workspace.name)).toEqual(expect.arrayContaining(["Chennai", "Mumbai"]));
    expect(ceoWorkspaces.body.workspaces).toHaveLength(2);

    const project = await request(app)
      .post(`/api/workspaces/${chennaiId}/projects`)
      .set("Cookie", md)
      .send({ name: "Chennai project" });
    expect(project.status).toBe(201);
    expect((await request(app).get(`/api/projects/${project.body.project._id}`).set("Cookie", md)).status).toBe(200);
    expect((await request(app).get(`/api/workspaces/${mumbaiId}/projects`).set("Cookie", md)).status).toBe(403);
    const ceoProject = await request(app)
      .post(`/api/workspaces/${mumbaiId}/projects`)
      .set("Cookie", ceo)
      .send({ name: "Mumbai project" });
    expect(ceoProject.status).toBe(201);
    const changedRole = await request(app)
      .patch(`/api/workspaces/${chennaiId}/members/${staffRes.body.user._id}`)
      .set("Cookie", ceo)
      .send({ role: "project_manager" });
    expect(changedRole.status).toBe(200);

    const invitedStaff = await request(app)
      .post(`/api/workspaces/${chennaiId}/invites`)
      .set("Cookie", md)
      .send({ email: "new-staff@example.com", role: "member" });
    expect(invitedStaff.status).toBe(200);
    const leadershipInvite = await request(app)
      .post(`/api/workspaces/${chennaiId}/invites`)
      .set("Cookie", md)
      .send({ email: "other-ceo@example.com", role: "admin" });
    expect(leadershipInvite.status).toBe(403);
    const removeCeo = await request(app)
      .delete(`/api/workspaces/${chennaiId}/members/${ceoRes.body.user._id}`)
      .set("Cookie", md);
    expect(removeCeo.status).toBe(403);
    const removeStaff = await request(app)
      .delete(`/api/workspaces/${chennaiId}/members/${staffRes.body.user._id}`)
      .set("Cookie", md);
    expect(removeStaff.status).toBe(200);
  });

  test("workspace and project permissions are enforced on the server", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const memberRes = await register(app, { email: "member@example.com", name: "Member" });
    const strangerRes = await register(app, { email: "stranger@example.com", name: "Stranger" });
    const owner = ownerRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];
    const stranger = strangerRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Atlas" });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.workspace._id;

    const forbidden = await request(app).get(`/api/workspaces/${workspaceId}`).set("Cookie", stranger);
    expect(forbidden.status).toBe(403);

    const inviteDenied = await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", member)
      .send({ email: "stranger@example.com" });
    expect(inviteDenied.status).toBe(403);

    const invited = await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com", role: "member" });
    expect(invited.status).toBe(200);

    const memberProject = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", member)
      .send({ name: "Board" });
    expect(memberProject.status).toBe(403);
    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Board" });
    expect(project.status).toBe(201);

    const strangerBoard = await request(app)
      .get(`/api/projects/${project.body.project._id}`)
      .set("Cookie", stranger);
    expect(strangerBoard.status).toBe(403);
  });

  test("MDs manage workspace projects while other project access follows assignment and approval roles", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const memberRes = await register(app, { email: "member@example.com", name: "Member" });
    const mdRes = await register(app, { email: "md@example.com", name: "Managing Director" });
    const ctoRes = await register(app, { email: "cto@example.com", name: "CTO" });
    const owner = ownerRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];
    const md = mdRes.headers["set-cookie"][0];
    const cto = ctoRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Private projects" });
    const workspaceId = ws.body.workspace._id;
    await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", owner)
      .send({ email: "member@example.com", role: "member" });
    await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", owner)
      .send({ email: "md@example.com", role: "managing_director" });
    await request(app).post(`/api/workspaces/${workspaceId}/invites`).set("Cookie", owner)
      .send({ email: "cto@example.com", role: "cto" });
    const created = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Restricted project" });
    const projectId = created.body.project._id;

    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", md)).status).toBe(200);
    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", cto)).status).toBe(403);
    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", member)).status).toBe(403);
    expect((await request(app).get(`/api/workspaces/${workspaceId}/projects`).set("Cookie", md)).body.projects)
      .toHaveLength(1);
    expect((await request(app).get(`/api/workspaces/${workspaceId}/projects`).set("Cookie", cto)).body.projects)
      .toHaveLength(0);
    expect((await request(app).get(`/api/workspaces/${workspaceId}/projects`).set("Cookie", member)).body.projects)
      .toHaveLength(0);

    const approvedBusiness = await request(app)
      .post(`/api/projects/${projectId}/workflow`)
      .set("Cookie", md)
      .send({ action: "approve" });
    expect(approvedBusiness.status).toBe(200);
    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", md)).status).toBe(200);
    expect((await request(app).get(`/api/projects/${projectId}`).set("Cookie", cto)).status).toBe(200);
  });

  test("only owners and admins can remove other workspace members", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const adminRes = await register(app, { email: "admin@example.com", name: "Admin" });
    const memberRes = await register(app, { email: "member@example.com", name: "Member" });
    const owner = ownerRes.headers["set-cookie"][0];
    const admin = adminRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Team" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "admin@example.com", role: "admin" });
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com", role: "member" });

    const memberSelfRemoval = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${memberRes.body.user._id}`)
      .set("Cookie", member);
    const adminSelfRemoval = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${adminRes.body.user._id}`)
      .set("Cookie", admin);
    const adminRemovesMember = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${memberRes.body.user._id}`)
      .set("Cookie", admin);
    const ownerRemovesAdmin = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${adminRes.body.user._id}`)
      .set("Cookie", owner);

    expect(memberSelfRemoval.status).toBe(403);
    expect(adminSelfRemoval.status).toBe(403);
    expect(adminRemovesMember.status).toBe(200);
    expect(ownerRemovesAdmin.status).toBe(200);
  });

  test("owners and admins manage department assignments and reporting lines", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const adminRes = await register(app, { email: "admin@example.com", name: "Admin" });
    const memberRes = await register(app, { email: "employee@example.com", name: "Employee" });
    const owner = ownerRes.headers["set-cookie"][0];
    const admin = adminRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Company" });
    const workspaceId = ws.body.workspace._id;
    const orgDepartments = ws.body.workspace.organization.departments;
    expect(orgDepartments.map((department) => department.name)).toEqual(expect.arrayContaining([
      "Company Leadership",
      "Technology Leadership",
      "Frontend Team",
      "Backend Team",
    ]));
    expect(orgDepartments.find((department) => department.name === "Backend Team").positions).toEqual([
      "Node.js Developer",
      "Java Developer",
      "Python Developer",
    ]);

    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "admin@example.com", role: "admin" });
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "employee@example.com", role: "member" });

    const assignment = await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${memberRes.body.user._id}/organization`)
      .set("Cookie", admin)
      .send({
        department: "Frontend Team",
        title: "UI Developer",
        reportsTo: adminRes.body.user._id,
      });
    expect(assignment.status).toBe(200);
    const assigned = assignment.body.workspace.members.find((item) => item.user._id === memberRes.body.user._id);
    expect(assigned).toMatchObject({
      department: "Frontend Team",
      title: "UI Developer",
      reportsTo: adminRes.body.user._id,
    });

    const memberDenied = await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${memberRes.body.user._id}/organization`)
      .set("Cookie", member)
      .send({ department: "Frontend Team", title: "UI Developer", reportsTo: null });
    expect(memberDenied.status).toBe(403);

    const cycle = await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${adminRes.body.user._id}/organization`)
      .set("Cookie", admin)
      .send({ department: "", title: "", reportsTo: memberRes.body.user._id });
    expect(cycle.status).toBe(400);

    const departments = ws.body.workspace.organization.departments.filter((department) => department.name !== "Frontend Team");
    const updateStructure = await request(app)
      .patch(`/api/workspaces/${workspaceId}/organization`)
      .set("Cookie", admin)
      .send({ departments });
    expect(updateStructure.status).toBe(200);
    const unassigned = updateStructure.body.workspace.members.find((item) => item.user._id === memberRes.body.user._id);
    expect(unassigned).toMatchObject({ department: "", title: "" });

    const removeManager = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${adminRes.body.user._id}`)
      .set("Cookie", owner);
    expect(removeManager.status).toBe(200);
    const withoutManager = removeManager.body.workspace.members.find((item) => item.user._id === memberRes.body.user._id);
    expect(withoutManager.reportsTo).toBeNull();
  });

  test("viewers cannot mutate workspace content", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const viewerRes = await register(app, { email: "viewer@example.com", name: "Viewer" });
    const leadRes = await register(app, { email: "lead@example.com", name: "Lead" });
    const owner = ownerRes.headers["set-cookie"][0];
    const viewer = viewerRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Read only" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "viewer@example.com", role: "viewer" });
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "lead@example.com", role: "team_lead" });

    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Board" });
    const projectId = project.body.project._id;
    await advanceProjectToDevelopment(app, owner, projectId, [{
      department: "Frontend Team",
      teamLeadId: leadRes.body.user._id,
      memberIds: [leadRes.body.user._id],
    }]);
    const task = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Existing task" });
    const taskId = task.body.task._id;
    const comment = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/comments`)
      .set("Cookie", owner)
      .send({ body: "Existing comment" });
    const commentId = comment.body.task.comments[0]._id;
    const channels = await request(app)
      .get(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", viewer);
    const generalId = channels.body.channels.find((channel) => channel.name === "general")._id;

    const denied = await Promise.all([
      request(app).post(`/api/workspaces/${workspaceId}/projects`).set("Cookie", viewer).send({ name: "No project" }),
      request(app).post(`/api/projects/${projectId}/tasks`).set("Cookie", viewer).send({ title: "No task" }),
      request(app).patch(`/api/projects/${projectId}/tasks/${taskId}`).set("Cookie", viewer).send({ title: "Changed" }),
      request(app).delete(`/api/projects/${projectId}/tasks/${taskId}`).set("Cookie", viewer),
      request(app).post(`/api/projects/${projectId}/tasks/${taskId}/comments`).set("Cookie", viewer).send({ body: "No comment" }),
      request(app).delete(`/api/projects/${projectId}/tasks/${taskId}/comments/${commentId}`).set("Cookie", viewer),
      request(app).post(`/api/workspaces/${workspaceId}/channels`).set("Cookie", viewer).send({ name: "private" }),
      request(app).post(`/api/channels/${generalId}/messages`).set("Cookie", viewer).send({ body: "No message" }),
    ]);

    expect(denied.map((response) => response.status)).toEqual(Array(8).fill(403));
  });

  test("channel authorization rejects uploads before writing files", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const memberRes = await register(app, { email: "member@example.com", name: "Member" });
    const owner = ownerRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Private channel" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com", role: "member" });
    const channel = await request(app)
      .post(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", owner)
      .send({ name: "owners-only", memberIds: [] });
    const channelId = channel.body.channel._id;
    const before = new Set(fs.readdirSync(dest));

    const denied = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Cookie", member)
      .attach("files", Buffer.from("test image"), { filename: "upload.png", contentType: "image/png" });

    expect(denied.status).toBe(403);
    expect([...fs.readdirSync(dest)].filter((name) => !before.has(name))).toEqual([]);
  });

  test("uploaded files are removed when message persistence fails", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const owner = ownerRes.headers["set-cookie"][0];
    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Upload cleanup" });
    const workspaceId = ws.body.workspace._id;
    const channels = await request(app)
      .get(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", owner);
    const generalId = channels.body.channels.find((channel) => channel.name === "general")._id;
    const before = new Set(fs.readdirSync(dest));
    const createFailure = jest.spyOn(Message, "create").mockRejectedValueOnce(new Error("database write failed"));

    try {
      const failed = await request(app)
        .post(`/api/channels/${generalId}/messages`)
        .set("Cookie", owner)
        .attach("files", Buffer.from("test image"), { filename: "upload.png", contentType: "image/png" });

      expect(failed.status).toBe(500);
      expect([...fs.readdirSync(dest)].filter((name) => !before.has(name))).toEqual([]);
    } finally {
      createFailure.mockRestore();
    }
  });

  test("file downloads require workspace and channel membership", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const memberRes = await register(app, { email: "member@example.com", name: "Member" });
    const strangerRes = await register(app, { email: "stranger@example.com", name: "Stranger" });
    const owner = ownerRes.headers["set-cookie"][0];
    const member = memberRes.headers["set-cookie"][0];
    const stranger = strangerRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "File access" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com", role: "member" });
    const channels = await request(app)
      .get(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", owner);
    const generalId = channels.body.channels.find((channel) => channel.name === "general")._id;
    const privateChannel = await request(app)
      .post(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", owner)
      .send({ name: "owners-only", memberIds: [] });
    const privateChannelId = privateChannel.body.channel._id;

    const sharedMessage = await request(app)
      .post(`/api/channels/${generalId}/messages`)
      .set("Cookie", owner)
      .attach("files", Buffer.from("shared file"), { filename: "shared.txt", contentType: "text/plain" });
    const privateMessage = await request(app)
      .post(`/api/channels/${privateChannelId}/messages`)
      .set("Cookie", owner)
      .attach("files", Buffer.from("private file"), { filename: "private.txt", contentType: "text/plain" });
    const sharedFile = sharedMessage.body.message.attachments[0].filename;
    const privateFile = privateMessage.body.message.attachments[0].filename;

    try {
      const allowed = await request(app).get(`/api/files/${sharedFile}`).set("Cookie", member);
      const wrongChannel = await request(app).get(`/api/files/${privateFile}`).set("Cookie", member);
      const wrongWorkspace = await request(app).get(`/api/files/${sharedFile}`).set("Cookie", stranger);

      expect(allowed.status).toBe(200);
      expect(wrongChannel.status).toBe(403);
      expect(wrongWorkspace.status).toBe(403);
    } finally {
      for (const filename of [sharedFile, privateFile]) {
        fs.unlinkSync(require("path").join(dest, filename));
      }
    }
  });
});
