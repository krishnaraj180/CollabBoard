const os = require("os");
const path = require("path");

const MONGO_VERSION = "7.0.24";
const DOWNLOAD_DIR = path.join(__dirname, "..", "node_modules", ".cache", "mongodb-memory-server");
const STATE_FILE = path.join(os.tmpdir(), "collabboard-mongodb-memory-server.json");

function workerDatabaseName() {
  return `collabboard-test-worker-${process.env.JEST_WORKER_ID || "1"}`;
}

function workerMongoUri(baseUri) {
  const parsed = new URL(baseUri);
  parsed.pathname = `/${workerDatabaseName()}`;
  return parsed.toString().replace(/\/$/, "");
}

module.exports = { MONGO_VERSION, DOWNLOAD_DIR, STATE_FILE, workerDatabaseName, workerMongoUri };
