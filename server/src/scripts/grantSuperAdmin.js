const { connectDb, disconnectDb } = require("../config/db");
const User = require("../models/User");

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run grant-super-admin -- user@example.com");

  await connectDb();
  const user = await User.findOne({ email });
  if (!user) throw new Error(`No CollabBoard user exists with email ${email}`);
  if (user.platformRole === "super_admin") {
    console.log(`${email} is already a Super Admin.`);
    return;
  }
  user.platformRole = "super_admin";
  await user.save();
  console.log(`Granted platform-wide Super Admin access to ${email}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
