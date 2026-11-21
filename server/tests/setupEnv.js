const fs = require("fs");
const { STATE_FILE, workerMongoUri } = require("./mongoTestConfig");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-do-not-use";
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
process.env.MONGODB_URI = workerMongoUri(state.uri);
