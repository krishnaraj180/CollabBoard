module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setupEnv.js"],
  globalSetup: "<rootDir>/tests/globalSetup.js",
  globalTeardown: "<rootDir>/tests/globalTeardown.js",
  testTimeout: 30000,
};
