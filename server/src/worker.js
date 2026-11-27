const { Worker } = require("bullmq");
const { env } = require("./config/env");
const { MAIN_QUEUE, defaultJobOptions, connection, createQueues } = require("./queues");
const { log } = require("./utils/logger");

async function processJob(job) {
  if (!["email", "notification", "webhook"].includes(job.name)) throw new Error(`Unknown queue job type: ${job.name}`);
  log("info", `queue.${job.name}.processed`, { jobId: job.id, organizationId: job.data.organizationId || null });
  return { accepted: true, type: job.name };
}

async function main() {
  if (!env.redisUrl) throw new Error("REDIS_URL is required to start the worker");
  const { deadLetter } = createQueues();
  const worker = new Worker(MAIN_QUEUE, processJob, {
    connection: connection(),
    concurrency: Number(process.env.WORKER_CONCURRENCY || 5),
  });
  worker.on("completed", (job) => log("info", "queue.job.completed", { jobId: job.id, type: job.name, organizationId: job.data.organizationId || null }));
  worker.on("failed", async (job, error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts || defaultJobOptions.attempts;
    log("error", "queue.job.failed", { jobId: job.id, type: job.name, attemptsMade: job.attemptsMade, organizationId: job.data.organizationId || null, error: error.message });
    if (job.attemptsMade >= maxAttempts) {
      await deadLetter.add(job.name, { originalJobId: job.id, data: job.data, error: error.message }, { removeOnComplete: { age: 30 * 24 * 60 * 60 } });
      log("error", "queue.job.dead_lettered", { jobId: job.id, type: job.name, organizationId: job.data.organizationId || null });
    }
  });
  log("info", "queue.worker.started", { queue: MAIN_QUEUE, organizationId: null });
  const shutdown = async () => { await worker.close(); await deadLetter.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log("error", "queue.worker.failed", { error: error.message, organizationId: null });
  process.exitCode = 1;
});
