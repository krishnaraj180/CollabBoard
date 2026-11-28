const { Queue } = require("bullmq");
const { env } = require("../config/env");

const MAIN_QUEUE = "collabboard-jobs";
const DEAD_LETTER_QUEUE = "collabboard-dead-letter";
const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: false,
};

function connection() {
  if (!env.redisUrl) throw new Error("REDIS_URL is required for queue operations");
  const parsed = new URL(env.redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "rediss:" ? 6380 : 6379)),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function createQueues() {
  return {
    jobs: new Queue(MAIN_QUEUE, { connection: connection(), defaultJobOptions }),
    deadLetter: new Queue(DEAD_LETTER_QUEUE, { connection: connection() }),
  };
}

async function enqueue(type, data, options = {}) {
  const { jobs } = createQueues();
  try {
    return await jobs.add(type, data, { ...defaultJobOptions, ...options });
  } finally {
    await jobs.close();
  }
}

const enqueueEmail = (data, options) => enqueue("email", data, options);
const enqueueNotification = (data, options) => enqueue("notification", data, options);
const enqueueWebhook = (data, options) => enqueue("webhook", data, options);

module.exports = { MAIN_QUEUE, DEAD_LETTER_QUEUE, defaultJobOptions, connection, createQueues, enqueueEmail, enqueueNotification, enqueueWebhook };
