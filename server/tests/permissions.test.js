const request = require("supertest");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");

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
});
