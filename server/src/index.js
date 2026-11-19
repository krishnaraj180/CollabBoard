const http = require("http");
const { Server } = require("socket.io");
const { env } = require("./config/env");
const { connectDb, disconnectDb } = require("./config/db");
const { createApp } = require("./app");
const { attachSockets } = require("./sockets");
const { assertTenantReady } = require("./services/tenantStartupCheck");

async function main() {
  await connectDb();
  if (env.tenantEnforcement === "on") {
    await assertTenantReady({ override: env.tenantEnforcementOverride });
    if (env.tenantEnforcementOverride) {
      setInterval(() => assertTenantReady({ override: true }).catch((error) => console.error(error.message)), 60 * 60 * 1000).unref();
    }
  }
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: env.clientOrigins, credentials: true },
    maxHttpBufferSize: 1e6,
    pingInterval: 25000,
    pingTimeout: 20000,
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
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
