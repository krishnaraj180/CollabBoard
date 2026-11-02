const { connectDb, disconnectDb } = require("./config/db");
const User = require("./models/User");
const Workspace = require("./models/Workspace");
const Project = require("./models/Project");
const Task = require("./models/Task");
const Channel = require("./models/Channel");
const Message = require("./models/Message");
const Notification = require("./models/Notification");
const Activity = require("./models/Activity");

async function seed() {
  await connectDb();
  await Promise.all([
    User.deleteMany({}),
    Workspace.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Channel.deleteMany({}),
    Message.deleteMany({}),
    Notification.deleteMany({}),
    Activity.deleteMany({}),
  ]);

  const passwordHash = await User.hashPassword("Demo1234!");
  const krishna = await User.create({
    name: "Krishna",
    email: "krishna@collabboard.dev",
    passwordHash,
    avatarColor: "#2563eb",
  });
  const maya = await User.create({
    name: "Maya Chen",
    email: "maya@collabboard.dev",
    passwordHash,
    avatarColor: "#0891b2",
  });
  const leo = await User.create({
    name: "Leo Park",
    email: "leo@collabboard.dev",
    passwordHash,
    avatarColor: "#7c3aed",
  });

  const workspace = await Workspace.create({
    name: "Northwind Launch",
    description: "Shipping the interview-ready collaboration workspace.",
    members: [
      { user: krishna._id, role: "owner" },
      { user: maya._id, role: "admin" },
      { user: leo._id, role: "member" },
    ],
  });

  const general = await Channel.create({
    workspace: workspace._id,
    type: "group",
    name: "general",
    members: [krishna._id, maya._id, leo._id],
    createdBy: krishna._id,
  });
  await Channel.create({
    workspace: workspace._id,
    type: "group",
    name: "design-crit",
    members: [krishna._id, maya._id],
    createdBy: maya._id,
  });

  await Message.create({
    workspace: workspace._id,
    channel: general._id,
    sender: maya._id,
    body: "Board is live. Drop interview talking points in #general.",
  });
  await Message.create({
    workspace: workspace._id,
    channel: general._id,
    sender: leo._id,
    body: "I will demo the two-browser task updates after lunch.",
  });

  const day = 24 * 3600 * 1000;
  const inDays = (n) => new Date(Date.now() + n * day);

  const project = await Project.create({
    workspace: workspace._id,
    name: "Launch board",
    description: "Public demo of kanban + sockets",
    status: "active",
    dueDate: inDays(14),
    owner: krishna._id,
    createdBy: krishna._id,
  });
  const website = await Project.create({
    workspace: workspace._id,
    name: "Marketing site",
    description: "Landing page and onboarding copy",
    status: "planning",
    dueDate: inDays(30),
    owner: maya._id,
    createdBy: maya._id,
  });
  const research = await Project.create({
    workspace: workspace._id,
    name: "User research sprint",
    description: "Interviews and synthesis",
    status: "completed",
    completedAt: inDays(-3),
    dueDate: inDays(-5),
    owner: leo._id,
    createdBy: leo._id,
  });

  const tasks = await Task.create([
    {
      workspace: workspace._id, project: project._id, title: "JWT cookie auth + logout",
      columnId: "done", order: 0, createdBy: krishna._id, assignees: [krishna._id],
      labels: ["auth"], priority: "high", completedAt: inDays(-2),
    },
    {
      workspace: workspace._id, project: project._id, title: "Realtime task cards",
      columnId: "doing", order: 0, createdBy: maya._id, assignees: [maya._id, leo._id],
      labels: ["socket"], priority: "urgent", dueDate: inDays(2),
      checklist: [
        { text: "Emit task:updated from API", done: true },
        { text: "Handle reconnect", done: false },
        { text: "Two-browser demo", done: false },
      ],
    },
    {
      workspace: workspace._id, project: project._id, title: "Chat reconnect persistence",
      columnId: "todo", order: 0, createdBy: leo._id, assignees: [leo._id],
      labels: ["chat"], priority: "medium", dueDate: inDays(-1),
    },
    {
      workspace: workspace._id, project: project._id, title: "Mobile layout pass",
      columnId: "review", order: 0, createdBy: krishna._id, assignees: [maya._id],
      labels: ["ui"], priority: "high", dueDate: inDays(5),
    },
    {
      workspace: workspace._id, project: website._id, title: "Draft hero copy",
      columnId: "todo", order: 0, createdBy: maya._id, assignees: [maya._id], priority: "low",
    },
    {
      workspace: workspace._id, project: research._id, title: "Run 5 interviews",
      columnId: "done", order: 0, createdBy: leo._id, assignees: [leo._id], priority: "medium",
      completedAt: inDays(-6),
    },
  ]);
  tasks[1].comments.push({ author: leo._id, body: "Socket rooms are per workspace, so cards update everywhere." });
  await tasks[1].save();

  await Activity.create([
    { workspace: workspace._id, project: project._id, actor: krishna._id, action: "project.created", summary: "created project “Launch board”" },
    { workspace: workspace._id, project: project._id, task: tasks[0]._id, actor: krishna._id, action: "task.completed", summary: "completed “JWT cookie auth + logout”" },
    { workspace: workspace._id, project: project._id, task: tasks[1]._id, actor: leo._id, action: "task.commented", summary: "commented on “Realtime task cards”" },
  ]);

  console.log("Seeded demo users:");
  console.log("  krishna@collabboard.dev / Demo1234!");
  console.log("  maya@collabboard.dev / Demo1234!");
  console.log("  leo@collabboard.dev / Demo1234!");
  await disconnectDb();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
