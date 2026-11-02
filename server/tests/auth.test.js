const request = require("supertest");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");

describe("auth", () => {
  let app;

  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);
  beforeEach(clearDb);

  test("register, login, me, and logout work", async () => {
    const created = await register(app);
    expect(created.status).toBe(201);
    expect(created.body.user.email).toBe("krishna@example.com");
    expect(created.headers["set-cookie"]).toBeDefined();

    const login = await request(app).post("/api/auth/login").send({
      email: "krishna@example.com",
      password: "password12",
    });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0];

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe("Krishna");

    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(200);

    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  test("rejects invalid credentials and payloads", async () => {
    await register(app);
    const badLogin = await request(app).post("/api/auth/login").send({
      email: "krishna@example.com",
      password: "wrong-pass",
    });
    expect(badLogin.status).toBe(401);

    const invalid = await request(app).post("/api/auth/register").send({
      name: "A",
      email: "not-an-email",
      password: "short",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("Invalid request");
  });
});

describe("account settings", () => {
  const request = require("supertest");
  const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");
  let app;
  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);
  beforeEach(clearDb);

  test("profile can be renamed and recoloured, bad colours are rejected", async () => {
    const reg = await register(app);
    const cookie = reg.headers["set-cookie"][0];
    const ok = await request(app).patch("/api/auth/me").set("Cookie", cookie).send({ name: "New Name", avatarColor: "#2563eb" });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: "New Name", avatarColor: "#2563eb" });
    const bad = await request(app).patch("/api/auth/me").set("Cookie", cookie).send({ avatarColor: "blue" });
    expect(bad.status).toBe(400);
  });

  test("changing the password checks the old one and ends old sessions", async () => {
    const reg = await register(app, { password: "password12" });
    const oldCookie = reg.headers["set-cookie"][0];
    const wrong = await request(app).post("/api/auth/password").set("Cookie", oldCookie).send({ currentPassword: "nope", newPassword: "newpassword1" });
    expect(wrong.status).toBe(400);
    const ok = await request(app).post("/api/auth/password").set("Cookie", oldCookie).send({ currentPassword: "password12", newPassword: "newpassword1" });
    expect(ok.status).toBe(200);
    const stale = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(stale.status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ email: "krishna@example.com", password: "newpassword1" });
    expect(login.status).toBe(200);
  });
});
