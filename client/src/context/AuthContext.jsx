"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      error,
      async register(payload) {
        setError("");
        const data = await api("/api/auth/register", { method: "POST", body: payload });
        setToken(data.token);
        setUser(data.user);
      },
      async login(payload) {
        setError("");
        const data = await api("/api/auth/login", { method: "POST", body: payload });
        setToken(data.token);
        setUser(data.user);
      },
      async logout() {
        await api("/api/auth/logout", { method: "POST" });
        setToken(null);
        setUser(null);
      },
    }),
    [user, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
