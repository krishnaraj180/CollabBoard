const { createClient } = require("redis");
const { env } = require("./env");

let clients = null;

async function connectRedis() {
  if (!env.redisUrl) return null;
  const pubClient = createClient({ url: env.redisUrl });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (error) => console.error(JSON.stringify({ event: "redis.client_error", role: "publisher", error: error.message })));
  subClient.on("error", (error) => console.error(JSON.stringify({ event: "redis.client_error", role: "subscriber", error: error.message })));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  clients = { pubClient, subClient };
  return clients;
}

async function disconnectRedis() {
  if (!clients) return;
  await Promise.all([clients.pubClient.quit(), clients.subClient.quit()]);
  clients = null;
}

module.exports = { connectRedis, disconnectRedis };
