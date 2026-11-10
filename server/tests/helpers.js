const http = require("http");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const { Server } = require("socket.io");
const { createApp } = require("../src/app");
const { connectDb, disconnectDb } = require("../src/config/db");
const { attachSockets } = require("../src/sockets");

let mongo;

async function startDb() {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}

async function stopDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await disconnectDb();
  if (mongo) await mongo.stop();
}

async function clearDb() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

function createTestApp() {
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: true, credentials: true } });
  app.set("io", io);
  attachSockets(io);
  return { app, server, io };
}

async function register(app, overrides = {}) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: overrides.name || "Krishna",
      email: overrides.email || "krishna@example.com",
      password: overrides.password || "password12",
    });
  return res;
}

async function advanceProjectToDevelopment(app, cookie, projectId, assignments) {
  const transition = (action) =>
    request(app).post(`/api/projects/${projectId}/workflow`).set("Cookie", cookie).send({ action });
  const business = await transition("approve");
  if (business.status !== 200) throw new Error(`Business approval setup failed: ${business.status} ${business.body.message || ""}`);
  const technical = await transition("approve");
  if (technical.status !== 200) throw new Error(`Technical review setup failed: ${technical.status} ${technical.body.message || ""}`);
  const plan = await request(app)
    .patch(`/api/projects/${projectId}`)
    .set("Cookie", cookie)
    .send({
      scope: "Test project scope",
      budget: 1000,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      milestones: ["Plan", "Build"],
    });
  if (plan.status !== 200) throw new Error(`Project planning setup failed: ${plan.status} ${plan.body.message || ""}`);
  const planSubmitted = await transition("submit");
  if (planSubmitted.status !== 200) throw new Error(`Project plan submission failed: ${planSubmitted.status} ${planSubmitted.body.message || ""}`);
  const teamPlan = await request(app)
    .patch(`/api/projects/${projectId}`)
    .set("Cookie", cookie)
    .send({
      departmentAssignments: assignments || [],
    });
  if (teamPlan.status !== 200) throw new Error(`Team assignment setup failed: ${teamPlan.status} ${teamPlan.body.message || ""}`);
  const teamSubmitted = await transition("submit");
  if (teamSubmitted.status !== 200) throw new Error(`Team assignment submission failed: ${teamSubmitted.status} ${teamSubmitted.body.message || ""}`);
  const designDone = await transition("complete");
  if (designDone.status !== 200) throw new Error(`Design setup failed: ${designDone.status} ${designDone.body.message || ""}`);
}

module.exports = { startDb, stopDb, clearDb, createTestApp, register, advanceProjectToDevelopment };
