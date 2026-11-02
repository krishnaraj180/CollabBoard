const request = require("supertest");
const { startDb, stopDb, clearDb, createTestApp, register } = require("./helpers");

describe("project management features", () => {
  let app;
  let owner;
  let member;
  let other;
  let workspaceId;
  let projectId;
  let ownerId;
  let memberId;

  beforeAll(async () => {
    await startDb();
    app = createTestApp().app;
  });
  afterAll(stopDb);

  beforeEach(async () => {
    await clearDb();
    const o = await register(app, { email: "owner@example.com", name: "Owner" });
    const m = await register(app, { email: "member@example.com", name: "Member" });
    const x = await register(app, { email: "other@example.com", name: "Other" });
    owner = o.headers["set-cookie"][0];
    member = m.headers["set-cookie"][0];
    other = x.headers["set-cookie"][0];
    ownerId = o.body.user._id;
    memberId = m.body.user._id;

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Atlas" });
    workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com" });
    const p = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Launch" });
    projectId = p.body.project._id;
  });

  test("only owners and admins can change project status", async () => {
    const denied = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", member)
      .send({ status: "on_hold" });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ status: "completed" });
    expect(ok.status).toBe(200);
    expect(ok.body.project.status).toBe("completed");
    expect(ok.body.project.completedAt).toBeTruthy();

    const bad = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ status: "nonsense" });
    expect(bad.status).toBe(400);
  });

  test("moving a task to the done column updates completion percent", async () => {
    const t1 = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", member)
      .send({ title: "One", priority: "high" });
    await request(app).post(`/api/projects/${projectId}/tasks`).set("Cookie", member).send({ title: "Two" });
    expect(t1.body.task.priority).toBe("high");

    const moved = await request(app)
      .patch(`/api/projects/${projectId}/tasks/${t1.body.task._id}`)
      .set("Cookie", member)
      .send({ columnId: "done" });
    expect(moved.status).toBe(200);
    expect(moved.body.task.completedAt).toBeTruthy();

    const board = await request(app).get(`/api/projects/${projectId}`).set("Cookie", owner);
    expect(board.body.stats).toMatchObject({ total: 2, completed: 1, percent: 50 });
    expect(board.body.myRole).toBe("owner");

    const back = await request(app)
      .patch(`/api/projects/${projectId}/tasks/${t1.body.task._id}`)
      .set("Cookie", member)
      .send({ columnId: "todo" });
    expect(back.body.task.completedAt).toBeUndefined();
  });

  test("assignees must belong to the workspace", async () => {
    const strangerMe = await request(app).get("/api/auth/me").set("Cookie", other);
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Nope", assignees: [strangerMe.body.user._id] });
    expect(res.status).toBe(400);
  });

  test("members can only delete their own tasks; admins can delete any", async () => {
    const ownerTask = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Owner task" });
    const denied = await request(app)
      .delete(`/api/projects/${projectId}/tasks/${ownerTask.body.task._id}`)
      .set("Cookie", member);
    expect(denied.status).toBe(403);

    const mine = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", member)
      .send({ title: "Member task" });
    const own = await request(app)
      .delete(`/api/projects/${projectId}/tasks/${mine.body.task._id}`)
      .set("Cookie", member);
    expect(own.status).toBe(200);

    const adminDelete = await request(app)
      .delete(`/api/projects/${projectId}/tasks/${ownerTask.body.task._id}`)
      .set("Cookie", owner);
    expect(adminDelete.status).toBe(200);
  });

  test("comments, checklist, activity and notifications work end to end", async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({
        title: "Spec",
        assignees: [memberId],
        checklist: [{ text: "Draft", done: false }],
      });
    expect(created.status).toBe(201);
    expect(created.body.task.checklist).toHaveLength(1);

    const notes = await request(app).get("/api/notifications").set("Cookie", member);
    expect(notes.body.notifications.some((n) => n.type === "task.assigned")).toBe(true);

    const commented = await request(app)
      .post(`/api/projects/${projectId}/tasks/${created.body.task._id}/comments`)
      .set("Cookie", member)
      .send({ body: "On it" });
    expect(commented.status).toBe(201);
    expect(commented.body.task.comments[0].body).toBe("On it");

    const empty = await request(app)
      .post(`/api/projects/${projectId}/tasks/${created.body.task._id}/comments`)
      .set("Cookie", member)
      .send({ body: "" });
    expect(empty.status).toBe(400);

    const activity = await request(app).get(`/api/projects/${projectId}/activity`).set("Cookie", owner);
    expect(activity.body.activity.length).toBeGreaterThanOrEqual(2);
  });

  test("dashboard and my-tasks summarise workload; strangers are blocked", async () => {
    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Past due", assignees: [memberId], dueDate: new Date(Date.now() - 86400000).toISOString() });

    const dash = await request(app).get(`/api/workspaces/${workspaceId}/dashboard`).set("Cookie", member);
    expect(dash.status).toBe(200);
    expect(dash.body.totals).toMatchObject({ projects: 1, tasks: 1, overdue: 1 });
    const row = dash.body.workload.find((w) => w.user._id === memberId);
    expect(row).toMatchObject({ open: 1, overdue: 1 });

    const mine = await request(app).get(`/api/workspaces/${workspaceId}/my-tasks`).set("Cookie", member);
    expect(mine.body.tasks).toHaveLength(1);
    expect(mine.body.tasks[0]).toMatchObject({ overdue: true, done: false, doneColumnId: "done" });

    const blocked = await request(app).get(`/api/workspaces/${workspaceId}/dashboard`).set("Cookie", other);
    expect(blocked.status).toBe(403);
  });

  test("removing a member unassigns their tasks; deleting a project removes its tasks", async () => {
    const t = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Shared", assignees: [memberId] });
    expect(t.status).toBe(201);

    const removed = await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${memberId}`)
      .set("Cookie", owner);
    expect(removed.status).toBe(200);
    const board = await request(app).get(`/api/projects/${projectId}`).set("Cookie", owner);
    expect(board.body.tasks[0].assignees).toHaveLength(0);

    const memberDelete = await request(app).delete(`/api/projects/${projectId}`).set("Cookie", other);
    expect(memberDelete.status).toBe(403);
    const del = await request(app).delete(`/api/projects/${projectId}`).set("Cookie", owner);
    expect(del.status).toBe(200);
    const gone = await request(app).get(`/api/projects/${projectId}`).set("Cookie", owner);
    expect(gone.status).toBe(404);
    expect(ownerId).toBeTruthy();
  });
});
