const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: MONGODB_URI=... [BACKUP_DIR=backups] npm run backup:mongodb");
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups"));
  fs.mkdirSync(backupDir, { recursive: true });
  const archive = path.join(backupDir, `collabboard-${timestamp()}.archive.gz`);
  const mongodump = process.env.MONGODUMP_BIN || "mongodump";
  await execFileAsync(mongodump, ["--uri", uri, "--archive", archive, "--gzip"], { maxBuffer: 2 * 1024 * 1024 });
  console.log(JSON.stringify({ event: "mongodb.backup.completed", archive, bytes: fs.statSync(archive).size, timestamp: new Date().toISOString() }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "mongodb.backup.failed", error: error.message, timestamp: new Date().toISOString() }));
  process.exitCode = 1;
});
