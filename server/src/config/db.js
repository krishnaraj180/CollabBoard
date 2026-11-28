const dns = require("dns");
const mongoose = require("mongoose");
const { env } = require("./env");

// Fix for querySrv ECONNREFUSED on ISPs/routers that fail DNS SRV records
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore if custom DNS servers cannot be set
}

async function connectDb(uri = env.mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { autoIndex: !env.isProd });
}

async function disconnectDb() {
  await mongoose.disconnect();
}

async function isDbReady() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { connectDb, disconnectDb, isDbReady };
