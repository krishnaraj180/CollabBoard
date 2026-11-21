const fs = require("fs");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MONGO_VERSION, DOWNLOAD_DIR, STATE_FILE } = require("./mongoTestConfig");

module.exports = async function globalSetup() {
  process.env.MONGOMS_DOWNLOAD_DIR = DOWNLOAD_DIR;
  process.env.MONGOMS_VERSION = MONGO_VERSION;
  const mongo = await MongoMemoryServer.create({
    binary: { version: MONGO_VERSION, downloadDir: DOWNLOAD_DIR },
    instance: { port: 0, dbName: "collabboard-test", launchTimeout: 60000 },
  });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ uri: mongo.getUri(), version: MONGO_VERSION }, null, 2));
  global.__COLLABBOARD_MONGO__ = mongo;
};
