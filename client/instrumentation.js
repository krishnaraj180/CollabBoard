import { scrubEvent } from "./src/lib/sentry";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    });
  }
}
