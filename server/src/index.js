const http = require("http");
const { Server } = require("socket.io");
const { env, validateStartupEnv } = require("./config/env");
const { connectDb, disconnectDb } = require("./config/db");
const { createApp } = require("./app");
const { attachSockets } = require("./sockets");
const { assertTenantReady } = require("./services/tenantStartupCheck");
const { initSentry } = require("./config/sentry");
const { log } = require("./utils/logger");
const { connectRedis, disconnectRedis } = require("./config/redis");
const { createAdapter } = require("@socket.io/redis-adapter");

initSentry();
validateStartupEnv();

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
  const redis = await connectRedis();
  const io = new Server(server, {
    cors: { origin: env.clientOrigins, credentials: true },
    maxHttpBufferSize: 1e6,
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  if (redis) io.adapter(createAdapter(redis.pubClient, redis.subClient));
  else if (env.isProd) throw new Error("Redis is required for the production Socket.IO adapter");
  else log("warn", "redis.adapter.disabled", { organizationId: null });
  app.set("io", io);
  attachSockets(io);

  server.listen(env.port, () => {
    log("info", "server.started", { port: env.port, environment: env.nodeEnv, organizationId: null });
  });

  // Let in-flight requests finish when the host stops the container.
  const shutdown = (signal) => {
    log("info", "server.shutdown", { signal, organizationId: null });
    io.close();
    server.close(async () => {
      await disconnectDb();
      await disconnectRedis();
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
