const request = require("supertest");
const fs = require("fs");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");
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

    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", member)
      .send({ name: "Board" });
    expect(project.status).toBe(201);

    const strangerBoard = await request(app)
      .get(`/api/projects/${project.body.project._id}`)
      .set("Cookie", stranger);
    expect(strangerBoard.status).toBe(403);
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

  test("viewers cannot mutate workspace content", async () => {
    const ownerRes = await register(app, { email: "owner@example.com", name: "Owner" });
    const viewerRes = await register(app, { email: "viewer@example.com", name: "Viewer" });
    const owner = ownerRes.headers["set-cookie"][0];
    const viewer = viewerRes.headers["set-cookie"][0];

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Read only" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "viewer@example.com", role: "viewer" });

    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Board" });
    const projectId = project.body.project._id;
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
