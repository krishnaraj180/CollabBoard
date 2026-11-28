const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: BACKUP_ARCHIVE=... RESTORE_MONGODB_URI=... RESTORE_CONFIRM=collabboard-restore npm run restore:mongodb:test");
    return;
  }
  const archive = process.env.BACKUP_ARCHIVE;
  const targetUri = process.env.RESTORE_MONGODB_URI;
  if (!archive || !fs.existsSync(archive)) throw new Error("BACKUP_ARCHIVE must point to an existing archive");
  if (!targetUri) throw new Error("RESTORE_MONGODB_URI is required");
  if (process.env.RESTORE_CONFIRM !== "collabboard-restore") throw new Error("Set RESTORE_CONFIRM=collabboard-restore to confirm a restore into the target database");
  const mongorestore = process.env.MONGORESTORE_BIN || "mongorestore";
  await execFileAsync(mongorestore, ["--uri", targetUri, "--archive", archive, "--gzip", "--drop"], { maxBuffer: 2 * 1024 * 1024 });
  console.log(JSON.stringify({ event: "mongodb.restore.completed", archive, timestamp: new Date().toISOString() }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "mongodb.restore.failed", error: error.message, timestamp: new Date().toISOString() }));
  process.exitCode = 1;
});
