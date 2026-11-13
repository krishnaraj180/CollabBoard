const request = require("supertest");
const { startDb, stopDb, clearDb, createTestApp, register, advanceProjectToDevelopment } = require("./helpers");
const User = require("../src/models/User");

describe("project management features", () => {
  let app;
  let owner;
  let member;
  let other;
  let workspaceId;
  let projectId;
  let ownerId;
  let memberId;
  let otherId;

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
    otherId = x.body.user._id;

    const ws = await request(app).post("/api/workspaces").set("Cookie", owner).send({ name: "Atlas" });
    workspaceId = ws.body.workspace._id;
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "member@example.com", role: "team_lead" });
    const p = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Launch" });
    projectId = p.body.project._id;
    await advanceProjectToDevelopment(app, owner, projectId, [{
      department: "Frontend Team",
      teamLeadId: memberId,
      memberIds: [memberId],
    }]);
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
      .send({ status: "on_hold" });
    expect(ok.status).toBe(200);
    expect(ok.body.project.status).toBe("on_hold");

    const bypass = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ status: "completed" });
    expect(bypass.status).toBe(409);

    const bad = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ status: "nonsense" });
    expect(bad.status).toBe(400);
  });

  test("project managers can manage only assigned projects and report progress to workspace executives", async () => {
    const pmRes = await register(app, { email: "pm@example.com", name: "Project Manager" });
    const mdRes = await register(app, { email: "md@example.com", name: "Managing Director" });
    const pm = pmRes.headers["set-cookie"][0];
    const md = mdRes.headers["set-cookie"][0];
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "pm@example.com", role: "project_manager" });
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "md@example.com", role: "admin" });

    const assigned = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ projectManagerId: pmRes.body.user._id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.project.projectManager._id).toBe(pmRes.body.user._id);

    const invalidAssignment = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", owner)
      .send({ projectManagerId: memberId });
    expect(invalidAssignment.status).toBe(400);
    const memberAssignment = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", member)
      .send({ projectManagerId: pmRes.body.user._id });
    expect(memberAssignment.status).toBe(403);

    const unassignedProject = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner)
      .send({ name: "Unassigned" });
    const forbiddenBoard = await request(app)
      .get(`/api/projects/${unassignedProject.body.project._id}`)
      .set("Cookie", pm);
    expect(forbiddenBoard.status).toBe(403);

    const projectList = await request(app)
      .get(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", pm);
    expect(projectList.body.projects.map((project) => project._id)).toEqual([projectId]);

    const dashboard = await request(app)
      .get(`/api/workspaces/${workspaceId}/dashboard`)
      .set("Cookie", pm);
    expect(dashboard.body.totals.projects).toBe(1);

    const statusUpdate = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("Cookie", pm)
      .send({ status: "on_hold" });
    expect(statusUpdate.status).toBe(200);

    const ownerNotifications = await request(app).get("/api/notifications").set("Cookie", owner);
    const mdNotifications = await request(app).get("/api/notifications").set("Cookie", md);
    const pmNotifications = await request(app).get("/api/notifications").set("Cookie", pm);
    expect(ownerNotifications.body.notifications.some((notification) => notification.type === "project.update")).toBe(true);
    expect(mdNotifications.body.notifications.some((notification) => notification.type === "project.update")).toBe(true);
    expect(pmNotifications.body.notifications.some((notification) => notification.type === "project.update")).toBe(true);

    const deleteDenied = await request(app).delete(`/api/projects/${projectId}`).set("Cookie", pm);
    expect(deleteDenied.status).toBe(403);

    const createdTask = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "PM can manage assigned project tasks" });
    const deleteTask = await request(app)
      .delete(`/api/projects/${projectId}/tasks/${createdTask.body.task._id}`)
      .set("Cookie", pm);
    expect(deleteTask.status).toBe(200);

    const demoted = await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${pmRes.body.user._id}`)
      .set("Cookie", owner)
      .send({ role: "member" });
    expect(demoted.status).toBe(200);
    expect(demoted.body.workspace.members.find((item) => item.user._id === pmRes.body.user._id).role).toBe("member");
    const unassignedAfterDemotion = await request(app)
      .get(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", owner);
    expect(unassignedAfterDemotion.body.projects.find((item) => item._id === projectId).projectManager).toBeNull();
    const projectAfterDemotion = await request(app).get(`/api/projects/${projectId}`).set("Cookie", pm);
    expect(projectAfterDemotion.status).toBe(403);
  });

  test("workspace leadership can add eligible members to an active project without changing its workflow stage", async () => {
    const invited = await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "other@example.com", role: "frontend_developer" });
    expect(invited.status).toBe(200);

    const setDepartment = (department, title) =>
      request(app)
        .patch(`/api/workspaces/${workspaceId}/members/${otherId}/organization`)
        .set("Cookie", owner)
        .send({ department, title });
    const wrongDepartment = await setDepartment("Backend Team", "Node.js Developer");
    expect(wrongDepartment.status).toBe(200);

    const rejected = await request(app)
      .post(`/api/projects/${projectId}/team-members`)
      .set("Cookie", owner)
      .send({ department: "Frontend Team", memberIds: [otherId] });
    expect(rejected.status).toBe(400);

    const correctDepartment = await setDepartment("Frontend Team", "React Developer");
    expect(correctDepartment.status).toBe(200);
    const blockedMember = await request(app)
      .post(`/api/projects/${projectId}/team-members`)
      .set("Cookie", member)
      .send({ department: "Frontend Team", memberIds: [otherId] });
    expect(blockedMember.status).toBe(403);

    const beforeAccess = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Cookie", other);
    expect(beforeAccess.status).toBe(403);

    const added = await request(app)
      .post(`/api/projects/${projectId}/team-members`)
      .set("Cookie", owner)
      .send({ department: "Frontend Team", memberIds: [otherId] });
    expect(added.status).toBe(200);
    expect(added.body.project.workflowStage).toBe("development");
    expect(added.body.addedMemberIds).toEqual([otherId]);
    const frontendTeam = added.body.project.departmentAssignments.find((assignment) => assignment.department === "Frontend Team");
    expect(frontendTeam.members.map((assignedMember) => assignedMember._id)).toContain(otherId);

    const afterAccess = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Cookie", other);
    expect(afterAccess.status).toBe(200);

    const duplicate = await request(app)
      .post(`/api/projects/${projectId}/team-members`)
      .set("Cookie", owner)
      .send({ department: "Frontend Team", memberIds: [otherId] });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.addedMemberIds).toEqual([]);
    expect(
      duplicate.body.project.departmentAssignments
        .find((assignment) => assignment.department === "Frontend Team")
        .members.filter((assignedMember) => assignedMember._id === otherId)
    ).toHaveLength(1);
  });

  test("role-based workflow enforces approvals, QA bug loops, deployment, and executive completion", async () => {
    const outsiderInvited = await request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set("Cookie", owner)
      .send({ email: "other@example.com", role: "team_lead" });
    expect(outsiderInvited.status).toBe(200);
    const roleUsers = {};
    for (const [key, role] of [
      ["md", "managing_director"],
      ["cto", "cto"],
      ["pm", "project_manager"],
      ["engineering", "engineering_manager"],
      ["design", "design_manager"],
      ["qa", "qa_manager"],
      ["devops", "devops_manager"],
      ["marketing", "marketing_manager"],
      ["finance", "finance_manager"],
    ]) {
      const account = await register(app, { email: `${key}@example.com`, name: key });
      roleUsers[key] = { cookie: account.headers["set-cookie"][0], userId: account.body.user._id };
      const invited = await request(app)
        .post(`/api/workspaces/${workspaceId}/invites`)
        .set("Cookie", owner)
        .send({ email: `${key}@example.com`, role });
      expect(invited.status).toBe(200);
    }

    const created = await request(app)
      .post(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({ name: "Workflow test" });
    expect(created.status).toBe(201);
    const workflowProjectId = created.body.project._id;
    expect(created.body.project.workflowStage).toBe("business_approval");

    const wrongApprover = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.cto.cookie)
      .send({ action: "approve" });
    expect(wrongApprover.status).toBe(403);

    const businessApproval = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.md.cookie)
      .send({ action: "approve" });
    expect(businessApproval.body.project.workflowStage).toBe("technical_review");
    const technicalReview = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.cto.cookie)
      .send({ action: "approve" });
    expect(technicalReview.body.project.workflowStage).toBe("project_setup");

    const planning = await request(app)
      .patch(`/api/projects/${workflowProjectId}`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({
        scope: "Deliver the approved release",
        budget: 25000,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        milestones: ["Design", "Release"],
      });
    expect(planning.status).toBe(200);
    const planSubmit = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({ action: "submit" });
    expect(planSubmit.body.project.workflowStage).toBe("team_assignment");

    const assignments = [
      { department: "Development Department", teamLeadId: roleUsers.engineering.userId, memberIds: [memberId] },
      { department: "Frontend Team", teamLeadId: memberId, memberIds: [memberId] },
      { department: "Design Department", teamLeadId: roleUsers.design.userId, memberIds: [roleUsers.design.userId] },
      { department: "QA Department", teamLeadId: roleUsers.qa.userId, memberIds: [roleUsers.qa.userId] },
      { department: "DevOps Department", teamLeadId: roleUsers.devops.userId, memberIds: [roleUsers.devops.userId] },
      { department: "Marketing Department", teamLeadId: roleUsers.marketing.userId, memberIds: [roleUsers.marketing.userId] },
      { department: "Finance Department", teamLeadId: roleUsers.finance.userId, memberIds: [roleUsers.finance.userId] },
    ];
    const invalidAssignment = await request(app)
      .patch(`/api/projects/${workflowProjectId}`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({
        departmentAssignments: [
          { department: "Frontend Team", teamLeadId: memberId, memberIds: [roleUsers.qa.userId] },
        ],
      });
    expect(invalidAssignment.status).toBe(400);

    const assigned = await request(app)
      .patch(`/api/projects/${workflowProjectId}`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({ departmentAssignments: assignments });
    expect(assigned.status).toBe(200);
    const teamsSubmitted = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.pm.cookie)
      .send({ action: "submit" });
    expect(teamsSubmitted.body.project.workflowStage).toBe("design");
    const unassignedLeadBoard = await request(app)
      .get(`/api/projects/${workflowProjectId}`)
      .set("Cookie", other);
    expect(unassignedLeadBoard.status).toBe(403);
    const unassignedLeadProjects = await request(app)
      .get(`/api/workspaces/${workspaceId}/projects`)
      .set("Cookie", other);
    expect(unassignedLeadProjects.body.projects).toHaveLength(0);

    for (const [cookie, action, next] of [
      [roleUsers.design.cookie, "complete", "development"],
      [roleUsers.engineering.cookie, "complete", "code_review"],
      [roleUsers.engineering.cookie, "approve", "qa_testing"],
    ]) {
      const result = await request(app)
        .post(`/api/projects/${workflowProjectId}/workflow`)
        .set("Cookie", cookie)
        .send({ action });
      expect(result.status).toBe(200);
      expect(result.body.project.workflowStage).toBe(next);
    }

    const blockedTask = await request(app)
      .post(`/api/projects/${workflowProjectId}/tasks`)
      .set("Cookie", owner)
      .send({ title: "Work cannot start during QA" });
    expect(blockedTask.status).toBe(409);

    const qaFailed = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.qa.cookie)
      .send({ action: "fail", note: "Checkout crashes on submit" });
    expect(qaFailed.status).toBe(200);
    expect(qaFailed.body.project.workflowStage).toBe("bug_fixing");
    const boardAfterFailure = await request(app).get(`/api/projects/${workflowProjectId}`).set("Cookie", member);
    expect(boardAfterFailure.body.tasks).toContainEqual(expect.objectContaining({
      title: "QA bug: Checkout crashes on submit",
      labels: ["bug"],
    }));

    const bugFixed = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", member)
      .send({ action: "complete" });
    expect(bugFixed.body.project.workflowStage).toBe("code_review");
    const codeApproved = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.engineering.cookie)
      .send({ action: "approve" });
    expect(codeApproved.body.project.workflowStage).toBe("qa_testing");
    const qaPassed = await request(app)
      .post(`/api/projects/${workflowProjectId}/workflow`)
      .set("Cookie", roleUsers.qa.cookie)
      .send({ action: "pass" });
    expect(qaPassed.body.project.workflowStage).toBe("deployment");

    for (const [key, action, next] of [
      ["devops", "deploy", "production_release"],
      ["devops", "release", "marketing_launch"],
      ["marketing", "launch", "finance_review"],
      ["finance", "complete", "delivery_review"],
      ["pm", "complete", "executive_review"],
      ["md", "complete", "completed"],
    ]) {
      const result = await request(app)
        .post(`/api/projects/${workflowProjectId}/workflow`)
        .set("Cookie", roleUsers[key].cookie)
        .send({ action });
      expect(result.status).toBe(200);
      expect(result.body.project.workflowStage).toBe(next);
    }

    const finished = await request(app).get(`/api/projects/${workflowProjectId}`).set("Cookie", owner);
    expect(finished.body.project).toMatchObject({ status: "completed", workflowStage: "completed" });
  }, 60000);

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

  test("dashboard ignores workspace members whose user records no longer exist", async () => {
    await User.findByIdAndDelete(memberId);

    const dash = await request(app)
      .get(`/api/workspaces/${workspaceId}/dashboard`)
      .set("Cookie", owner);

    expect(dash.status).toBe(200);
    expect(dash.body.workload.every((row) => row.user)).toBe(true);
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
