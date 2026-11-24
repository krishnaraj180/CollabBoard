"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { AUTH_EXPIRED_EVENT, SESSION_CHECK_EVENT } from "../api";
import { useAuth } from "./AuthContext";

const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;
  const [socket, setSocket] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [notifications, setNotifications] = useState([]);
  // Initialize from the browser's current network state so a page opened
  // while offline does not get a stale realtime status.
  const [offline, setOffline] = useState(() => typeof window !== "undefined" && !window.navigator.onLine);
  const [socketDown, setSocketDown] = useState(false);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      return undefined;
    }

    let next = null;
    let cancelled = false;

    async function connectSocket() {
      // Try to fetch socket auth token for cross-domain deployments (e.g. Vercel -> Render)
      let token = null;
      try {
        const authData = await api("/api/auth/socket-token");
        token = authData?.token || null;
      } catch {
        // Fall back to cookies if endpoint fails or local development
      }

      if (cancelled) return;

      next = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000", {
        withCredentials: true,
        transports: ["websocket"],
        auth: token ? { token } : undefined,
      });

      let sessionCheckRequested = false;
      setSocket(next);

      next.on("connect", () => {
        setOffline(false);
        setSocketDown(false);
        sessionCheckRequested = false;
        window.dispatchEvent(new Event("collabboard:realtime-connected"));
      });
      next.on("disconnect", () => setSocketDown(true));
      next.on("connect_error", (error) => {
        setSocketDown(true);
        const isAuthError = [
          "Authentication required",
          "Invalid session",
          "Session has ended",
          "User no longer exists",
        ].includes(error.message);

        if (isAuthError && !sessionCheckRequested) {
          sessionCheckRequested = true;
          window.dispatchEvent(new Event(SESSION_CHECK_EVENT));
        }
      });
      next.on("auth:session-changed", () => {
        window.dispatchEvent(new Event(SESSION_CHECK_EVENT));
      });
      next.on("auth:session-expired", () => {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      });
      next.on("presence:snapshot", ({ onlineUserIds: ids }) => setOnlineUserIds(ids || []));
      next.on("presence:update", ({ userId, online }) => {
        setOnlineUserIds((current) => {
          const set = new Set(current);
          if (online) set.add(String(userId));
          else set.delete(String(userId));
          return [...set];
        });
      });
      next.on("notification:new", (note) => setNotifications((n) => n.some((item) => String(item._id || item.id) === String(note._id || note.id)) ? n : [note, ...n].slice(0, 40)));
    }

    connectSocket();

    return () => {
      cancelled = true;
      if (next) next.close();
    };
  }, [userId]);

  const value = useMemo(
    () => ({
      socket,
      onlineUserIds,
      notifications,
      setNotifications,
      // A live socket is authoritative: some browsers can keep
      // navigator.onLine=false while WebSockets are working normally.
      disconnected: socketDown || (offline && !socket?.connected),
    }),
    [socket, onlineUserIds, notifications, offline, socketDown]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
