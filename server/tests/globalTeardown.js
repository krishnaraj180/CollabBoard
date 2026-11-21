const fs = require("fs");
const { STATE_FILE } = require("./mongoTestConfig");

module.exports = async function globalTeardown() {
  if (global.__COLLABBOARD_MONGO__) await global.__COLLABBOARD_MONGO__.stop();
  try {
    fs.unlinkSync(STATE_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
