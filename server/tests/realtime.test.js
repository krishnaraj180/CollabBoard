const request = require("supertest");
const { io: clientIo } = require("socket.io-client");
const { startDb, stopDb, clearDb, createTestApp, register, advanceProjectToDevelopment } = require("./helpers");

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function expectNoEvent(socket, event, action) {
  let received = false;
  const listener = () => {
    received = true;
  };
  socket.on(event, listener);
  await action();
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.off(event, listener);
  expect(received).toBe(false);
}

describe("realtime + persistence", () => {
  let app;
  let server;

  beforeAll(async () => {
    await startDb();
    const created = createTestApp();
    app = created.app;
    server = created.server;
    await new Promise((resolve) => server.listen(0, resolve));
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await stopDb();
  });
  beforeEach(clearDb);

  test("two sessions receive task updates and chat survives reconnect", async () => {
    const a = await register(app, { email: "a@example.com", name: "Ada" });
    const b = await register(app, { email: "b@example.com", name: "Ben" });
    const c = await register(app, { email: "c@example.com", name: "Unaffiliated lead" });
    const cookieA = a.headers["set-cookie"][0];
    const cookieB = b.headers["set-cookie"][0];
    const tokenA = a.body.token;
    const tokenB = b.body.token;

    const ws = await request(app).post("/api/workspaces").set("Cookie", cookieA).send({ name: "Live" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", cookieA)
      .send({ email: "b@example.com", role: "team_lead" });
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", cookieA)
      .send({ email: "c@example.com", role: "team_lead" });
    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", cookieA)
      .send({ name: "Kanban" });
    await advanceProjectToDevelopment(app, cookieA, project.body.project._id, [{
      department: "Frontend Team",
      teamLeadId: b.body.user._id,
      memberIds: [b.body.user._id],
    }]);
    const privateChannel = await request(app)
      .post(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", cookieA)
      .send({ name: "private", memberIds: [] });

    const port = server.address().port;
    const sA = clientIo(`http://127.0.0.1:${port}`, { auth: { token: tokenA }, transports: ["websocket"] });
    const sB = clientIo(`http://127.0.0.1:${port}`, { auth: { token: tokenB }, transports: ["websocket"] });
    const sC = clientIo(`http://127.0.0.1:${port}`, { auth: { token: c.body.token }, transports: ["websocket"] });
    const readyA = waitFor(sA, "presence:snapshot");
    const readyB = waitFor(sB, "presence:snapshot");
    const readyC = waitFor(sC, "presence:snapshot");
    await Promise.all([waitFor(sA, "connect"), waitFor(sB, "connect"), waitFor(sC, "connect")]);
    await Promise.all([readyA, readyB, readyC]);

    const joinDenied = await new Promise((resolve) => sB.emit("channel:join", privateChannel.body.channel._id, resolve));
    expect(joinDenied).toMatchObject({ ok: false, error: "Forbidden" });
    const typingDenied = await new Promise((resolve) =>
      sB.emit("chat:typing", { channelId: privateChannel.body.channel._id, typing: true }, resolve)
    );
    expect(typingDenied).toMatchObject({ ok: false, error: "Forbidden" });

    const channels = await request(app).get(`/api/workspaces/${workspaceId}/channels`).set("Cookie", cookieA);
    const general = channels.body.channels.find((c) => c.name === "general");
    const typingReceived = waitFor(sA, "chat:typing");
    const typingAllowed = await new Promise((resolve) =>
      sB.emit("chat:typing", { channelId: general._id, typing: true }, resolve)
    );
    expect(typingAllowed).toEqual({ ok: true });
    expect(await typingReceived).toMatchObject({ channelId: general._id, typing: true });

    const received = waitFor(sB, "task:updated");
    const createdTask = await request(app)
      .post(`/api/projects/${project.body.project._id}/tasks`)
      .set("Cookie", cookieA)
      .send({ title: "Ship sockets" });
    expect(createdTask.status).toBe(201);
    const update = await received;
    expect(update.task.title).toBe("Ship sockets");
    await expectNoEvent(sC, "task:updated", async () => {
      const response = await request(app)
        .post(`/api/projects/${project.body.project._id}/tasks`)
        .set("Cookie", cookieA)
        .send({ title: "Not assigned to the other lead" });
      expect(response.status).toBe(201);
    });
    await expectNoEvent(sC, "activity:new", async () => {
      const response = await request(app)
        .post(`/api/projects/${project.body.project._id}/tasks`)
        .set("Cookie", cookieA)
        .send({ title: "Activity is also scoped" });
      expect(response.status).toBe(201);
    });

    const posted = await request(app)
      .post(`/api/channels/${general._id}/messages`)
      .set("Cookie", cookieA)
      .send({ body: "hello after login" });
    expect(posted.status).toBe(201);

    sA.disconnect();
    const sA2 = clientIo(`http://127.0.0.1:${port}`, { auth: { token: tokenA }, transports: ["websocket"] });
    await waitFor(sA2, "connect");
    const history = await request(app).get(`/api/channels/${general._id}/messages`).set("Cookie", cookieA);
    expect(history.body.messages.some((m) => m.body === "hello after login")).toBe(true);

    sA2.disconnect();
    sB.disconnect();
    sC.disconnect();
  });

  test("project managers receive realtime updates only for their assigned projects", async () => {
    const owner = await register(app, { email: "owner@example.com", name: "Owner" });
    const assignedManager = await register(app, { email: "assigned@example.com", name: "Assigned PM" });
    const otherManager = await register(app, { email: "other-pm@example.com", name: "Other PM" });
    const lead = await register(app, { email: "lead@example.com", name: "Team Lead" });
    const ownerCookie = owner.headers["set-cookie"][0];
    const workspace = await request(app)
      .post("/api/workspaces")
      .set("Cookie", ownerCookie)
      .send({ name: "Projects" });
    const workspaceId = workspace.body.workspace._id;

    for (const [email, role] of [
      ["assigned@example.com", "project_manager"],
      ["other-pm@example.com", "project_manager"],
      ["lead@example.com", "team_lead"],
    ]) {
      await request(app)
        .post(`/api/workspaces/${workspaceId}/invites`)
        .set("Cookie", ownerCookie)
        .send({ email, role });
    }

    const assignedProject = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", ownerCookie)
      .send({ name: "Assigned project" });
    const unassignedProject = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", ownerCookie)
      .send({ name: "Unassigned project" });
    await request(app)
      .patch(`/api/projects/${assignedProject.body.project._id}`)
      .set("Cookie", ownerCookie)
      .send({ projectManagerId: assignedManager.body.user._id });
    const devAssignment = [{
      department: "Frontend Team",
      teamLeadId: lead.body.user._id,
      memberIds: [lead.body.user._id],
    }];
    await advanceProjectToDevelopment(app, ownerCookie, assignedProject.body.project._id, devAssignment);
    await advanceProjectToDevelopment(app, ownerCookie, unassignedProject.body.project._id, devAssignment);

    const port = server.address().port;
    const assignedSocket = clientIo(`http://127.0.0.1:${port}`, {
      auth: { token: assignedManager.body.token },
      transports: ["websocket"],
    });
    const otherSocket = clientIo(`http://127.0.0.1:${port}`, {
      auth: { token: otherManager.body.token },
      transports: ["websocket"],
    });
    const assignedReady = waitFor(assignedSocket, "presence:snapshot");
    const otherReady = waitFor(otherSocket, "presence:snapshot");
    await Promise.all([waitFor(assignedSocket, "connect"), waitFor(otherSocket, "connect")]);
    await Promise.all([assignedReady, otherReady]);

    const assignedTaskUpdate = waitFor(assignedSocket, "task:updated");
    const assignedActivity = waitFor(assignedSocket, "activity:new");
    const createdAssignedTask = await request(app)
      .post(`/api/projects/${assignedProject.body.project._id}/tasks`)
      .set("Cookie", ownerCookie)
      .send({ title: "Assigned task" });
    expect(createdAssignedTask.status).toBe(201);
    expect((await assignedTaskUpdate).task.title).toBe("Assigned task");
    expect((await assignedActivity).project).toBe(assignedProject.body.project._id);

    await expectNoEvent(otherSocket, "task:updated", async () => {
      const response = await request(app)
        .post(`/api/projects/${assignedProject.body.project._id}/tasks`)
        .set("Cookie", ownerCookie)
        .send({ title: "Hidden from another PM" });
      expect(response.status).toBe(201);
    });
    await expectNoEvent(assignedSocket, "task:updated", async () => {
      const response = await request(app)
        .post(`/api/projects/${unassignedProject.body.project._id}/tasks`)
        .set("Cookie", ownerCookie)
        .send({ title: "Unassigned task" });
      expect(response.status).toBe(201);
    });
    await expectNoEvent(otherSocket, "activity:new", async () => {
      const response = await request(app)
        .patch(`/api/projects/${unassignedProject.body.project._id}`)
        .set("Cookie", ownerCookie)
        .send({ status: "on_hold" });
      expect(response.status).toBe(200);
    });

    assignedSocket.disconnect();
    otherSocket.disconnect();
  });
});
