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

module.exports = { startDb, stopDb, clearDb, createTestApp, register };
