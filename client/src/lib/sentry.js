import * as Sentry from "@sentry/nextjs";

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|body|email)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function scrubString(value) {
  return value.replace(EMAIL, "[Filtered email]").replace(JWT, "[Filtered token]");
}

function scrubValue(value, key = "", depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (SENSITIVE_KEY.test(key)) return "[Filtered]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, "", depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrubValue(childValue, childKey, depth + 1)]));
}

export function scrubEvent(event) {
  const clean = scrubValue(event);
  if (clean.request) {
    delete clean.request.data;
    delete clean.request.cookies;
    delete clean.request.env;
    clean.request.headers = scrubValue(clean.request.headers, "headers");
    clean.request.query_string = scrubString(String(clean.request.query_string || ""));
  }
  return clean;
}

export function initClientSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
