const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const modes = ["off", "log", "on"];
const jestBin = path.join(__dirname, "..", "node_modules", "jest", "bin", "jest.js");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "collabboard-tenant-modes-"));
const results = [];
const tenantTests = [
  "tests/tenantAccess.test.js",
  "tests/tenantExpansion.test.js",
  "tests/realtimeEmit.test.js",
  "tests/realtimeEmitScan.test.js",
];

for (const mode of modes) {
  const result = spawnSync(process.execPath, [jestBin, "--runInBand", "--detectOpenHandles", "--runTestsByPath", ...tenantTests], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, NODE_ENV: "test", TENANT_ENFORCEMENT: mode },
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const logFile = path.join(outputDir, `${mode}.log`);
  fs.writeFileSync(logFile, output);
  results.push({ mode, status: result.status, signal: result.signal, logFile });
  console.log(`TENANT_ENFORCEMENT=${mode} status=${result.status} log=${logFile}`);
}

if (results.some((result) => result.status !== 0)) process.exitCode = 1;
