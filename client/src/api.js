export const AUTH_EXPIRED_EVENT = "collabboard:auth-expired";
export const SESSION_CHECK_EVENT = "collabboard:session-check";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
    body:
      options.body instanceof FormData || !options.body || headers["Content-Type"] !== "application/json"
        ? options.body
        : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    err.details = data.details;
    if (res.status === 401 && path !== "/api/auth/login" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw err;
  }
  return data;
}
