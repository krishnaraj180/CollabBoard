const { connectDb, disconnectDb } = require("../config/db");
const Channel = require("../models/Channel");
const Message = require("../models/Message");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");

async function main() {
  await connectDb();
  for (const model of [Channel, Message, Activity, Notification]) {
    await model.createIndexes();
    console.log(`${model.modelName}: indexes ensured`);
  }
}

main()
  .catch((error) => {
    console.error("Tenant index build failed:", error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
