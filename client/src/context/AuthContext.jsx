"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, AUTH_EXPIRED_EVENT, SESSION_CHECK_EVENT } from "../api";

const AuthContext = createContext(null);
const AUTH_STORAGE_KEY = "cb_auth_event";
const AUTH_CHANNEL_NAME = "collabboard-auth";
const seenAuthEventIds = new Set();
let initialSessionRequest;
let authChannel;

function broadcastAuthState(type) {
  const message = {
    type,
    id: `${Date.now()}-${Math.random()}`,
  };
  if (authChannel) {
    try {
      authChannel.postMessage(message);
    } catch {
      // Fall back to the storage event below.
    }
  }
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Cross-tab notifications are best-effort; cookie authentication remains authoritative.
  }
}

function getInitialSession() {
  if (!initialSessionRequest) {
    initialSessionRequest = api("/api/auth/me").finally(() => {
      initialSessionRequest = null;
    });
  }
  return initialSessionRequest;
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initialized = useRef(false);

  const refreshUser = useCallback(async () => {
    const data = await api("/api/auth/me");
    setUserState(data.user);
    setError("");
    return data.user;
  }, []);

  const setUser = useCallback((nextUser) => {
    setUserState(nextUser);
    broadcastAuthState(nextUser ? "session-refresh" : "signed-out");
  }, []);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    let refreshTimer;

    try {
      localStorage.removeItem("cb_token");
    } catch {
      // Cookie authentication does not depend on local storage.
    }

    function onAuthExpired() {
      authChanged = true;
      setUserState(null);
      if (!initialized.current) return;
      setError("Your session has expired. Please sign in again.");
      broadcastAuthState("signed-out");
    }

    function onSessionCheck() {
      authChanged = true;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshUser().catch((refreshError) => {
          if (refreshError.status !== 401) {
            setError("Unable to refresh your session. Check your connection and try again.");
          }
        });
      }, 100);
    }

    function onStorage(event) {
      if (event.key !== AUTH_STORAGE_KEY || !event.newValue) return;
      try {
        onAuthMessage(JSON.parse(event.newValue));
      } catch {
        setError("Unable to synchronize your session between tabs.");
      }
    }

    function onAuthMessage(message) {
      if (!message?.id || seenAuthEventIds.has(message.id)) return;
      seenAuthEventIds.add(message.id);
      if (seenAuthEventIds.size > 100) {
        seenAuthEventIds.delete(seenAuthEventIds.values().next().value);
      }
      authChanged = true;
      if (message.type === "signed-out") {
        setUserState(null);
        setError("Your session ended in another tab or device.");
      } else if (message.type === "session-refresh") {
        refreshUser().catch((refreshError) => {
          if (refreshError.status !== 401) {
            setError("Unable to refresh your session. Check your connection and try again.");
          }
        });
      }
    }

    let channel;
    try {
      if ("BroadcastChannel" in window) {
        channel = new window.BroadcastChannel(AUTH_CHANNEL_NAME);
        authChannel = channel;
        channel.addEventListener("message", (event) => onAuthMessage(event.data));
      }
    } catch {
      channel = undefined;
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    window.addEventListener(SESSION_CHECK_EVENT, onSessionCheck);
    window.addEventListener("storage", onStorage);

    getInitialSession()
      .then((data) => {
        if (active && !authChanged) setUserState(data.user);
      })
      .catch((initialError) => {
        if (!active || authChanged) return;
        setUserState(null);
        if (initialError.status !== 401) {
          setError("Unable to verify your session. Check your connection and try again.");
        }
      })
      .finally(() => {
        if (active) {
          initialized.current = true;
          setLoading(false);
        }
      });

    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
      window.removeEventListener(SESSION_CHECK_EVENT, onSessionCheck);
      window.removeEventListener("storage", onStorage);
      if (channel) {
        channel.close();
        if (authChannel === channel) authChannel = undefined;
      }
    };
  }, [refreshUser]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      error,
      async register(payload) {
        setError("");
        const data = await api("/api/auth/register", { method: "POST", body: payload });
        setUserState(data.user);
        broadcastAuthState("session-refresh");
      },
      async login(payload) {
        setError("");
        const data = await api("/api/auth/login", { method: "POST", body: payload });
        setUserState(data.user);
        broadcastAuthState("session-refresh");
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" });
        setUserState(null);
        setError("");
        broadcastAuthState("signed-out");
      },
    }),
    [user, setUser, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
