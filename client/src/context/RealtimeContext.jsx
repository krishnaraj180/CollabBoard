"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { getToken } from "../api";
import { useAuth } from "./AuthContext";

const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [offline, setOffline] = useState(false);
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
    const next = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000", {
      auth: { token: getToken() },
      withCredentials: true,
    });
    setSocket(next);
    next.on("connect", () => setSocketDown(false));
    next.on("disconnect", () => setSocketDown(true));
    next.on("connect_error", () => setSocketDown(true));
    next.on("presence:snapshot", ({ onlineUserIds: ids }) => setOnlineUserIds(ids || []));
    next.on("presence:update", ({ userId, online }) => {
      setOnlineUserIds((current) => {
        const set = new Set(current);
        if (online) set.add(String(userId));
        else set.delete(String(userId));
        return [...set];
      });
    });
    next.on("notification:new", (note) => setNotifications((n) => [note, ...n].slice(0, 40)));
    return () => next.close();
  }, [user]);

  const value = useMemo(
    () => ({
      socket,
      onlineUserIds,
      notifications,
      setNotifications,
      disconnected: offline || socketDown,
    }),
    [socket, onlineUserIds, notifications, offline, socketDown]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
