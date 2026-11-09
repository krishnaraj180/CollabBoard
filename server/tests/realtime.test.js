const request = require("supertest");
const { io: clientIo } = require("socket.io-client");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
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
    const cookieA = a.headers["set-cookie"][0];
    const cookieB = b.headers["set-cookie"][0];
    const tokenA = a.body.token;
    const tokenB = b.body.token;

    const ws = await request(app).post("/api/workspaces").set("Cookie", cookieA).send({ name: "Live" });
    const workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", cookieA)
      .send({ email: "b@example.com" });
    const project = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", cookieA)
      .send({ name: "Kanban" });
    const privateChannel = await request(app)
      .post(`/api/workspaces/${workspaceId}/channels`)
      .set("Cookie", cookieA)
      .send({ name: "private", memberIds: [] });

    const port = server.address().port;
    const sA = clientIo(`http://127.0.0.1:${port}`, { auth: { token: tokenA }, transports: ["websocket"] });
    const sB = clientIo(`http://127.0.0.1:${port}`, { auth: { token: tokenB }, transports: ["websocket"] });
    const readyA = waitFor(sA, "presence:snapshot");
    const readyB = waitFor(sB, "presence:snapshot");
    await Promise.all([waitFor(sA, "connect"), waitFor(sB, "connect")]);
    await Promise.all([readyA, readyB]);

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
  });
});
