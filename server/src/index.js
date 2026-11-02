const http = require("http");
const { Server } = require("socket.io");
const { env } = require("./config/env");
const { connectDb } = require("./config/db");
const { createApp } = require("./app");
const { attachSockets } = require("./sockets");

async function main() {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: env.clientOrigins, credentials: true },
  });
  app.set("io", io);
  attachSockets(io);

  server.listen(env.port, () => {
    console.log(`CollabBoard API on http://localhost:${env.port}`);
  });

  // Let in-flight requests finish when the host stops the container.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
