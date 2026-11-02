"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useNav } from "../context/NavContext";
import { useRealtime } from "../context/RealtimeContext";
import { Avatar, Logo } from "./ui";
import { timeAgo } from "../lib/format";

const THEME_KEY = "cb_theme";

function useTheme() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      const next = saved || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setTheme(next);
      document.documentElement.dataset.theme = next;
    } catch {
      /* storage unavailable: stay on light */
    }
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }
  return [theme, toggle];
}

const NAV_ICONS = {
  home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  dash: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  tasks: "M5 12l4 4 10-10M5 5h14M5 19h14",
  team: "M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};

function Icon({ name }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={NAV_ICONS[name]} />
    </svg>
  );
}

export default function AppShell({ children }) {
  const { user, loading, logout } = useAuth();
  const { disconnected, notifications, setNotifications } = useRealtime();
  const { workspaceId, workspaces, projects, channels } = useNav();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const router = useRouter();
  const pathname = usePathname() || "";

  // Send signed-out visitors to the login page instead of showing a broken shell.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api("/api/notifications")
      .then((data) => setNotifications(data.notifications))
      .catch(() => {});
  }, [user, setNotifications]);

  // Close the mobile drawer and bell when navigating.
  useEffect(() => {
    setMenu(false);
    setOpen(false);
    setProfileMenu(false);
  }, [pathname]);

  const unread = notifications.filter((n) => !n.read).length;

  async function toggleBell() {
    const opening = !open;
    setOpen(opening);
    if (opening && unread > 0) {
      await api("/api/notifications/read", { method: "POST" }).catch(() => {});
      setTimeout(() => setNotifications((list) => list.map((n) => ({ ...n, read: true }))), 1500);
    }
  }

  async function confirmLogout() {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
      setLogoutOpen(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="boot">
        <Logo />
        <div className="skeleton" style={{ width: 220 }} />
      </div>
    );
  }

  const base = workspaceId ? `/app/w/${workspaceId}` : null;
  const item = (href, label, active, icon, extra, key) => (
    <Link key={key || href} className={`nav-link ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      {icon && <Icon name={icon} />}
      <span className="nav-label">{label}</span>
      {extra}
    </Link>
  );

  return (
    <div className="app">
      {menu && <div className="scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
      <aside className={`sidebar ${menu ? "open" : ""}`} aria-label="Main navigation">
        <Link className="brand" href="/app">
          <Logo />
        </Link>

        <div className="ws-switch">
          <label className="nav-heading" htmlFor="ws-select">
            Workspace
          </label>
          <select
            id="ws-select"
            value={workspaceId || ""}
            onChange={(e) => router.push(e.target.value ? `/app/w/${e.target.value}` : "/app")}
          >
            {!workspaceId && <option value="">Select a workspace…</option>}
            {workspaces.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="nav-scroll">
          {item("/app", "All workspaces", pathname === "/app", "home")}
          {base && (
            <>
              {item(base, "Dashboard", pathname === base, "dash")}
              {item(`${base}/my-tasks`, "My tasks", pathname === `${base}/my-tasks`, "tasks")}
              {item(`${base}/team`, "Team & roles", pathname === `${base}/team`, "team")}

              <div className="nav-heading">Projects</div>
              {projects.length === 0 && <div className="nav-empty">No projects yet</div>}
              {projects.map((p) =>
                item(
                  `${base}/projects/${p._id}`,
                  p.name,
                  pathname.startsWith(`${base}/projects/${p._id}`),
                  null,
                  <span key="badge">
                    <span className={`nav-dot ${p.status}`} title={p.status.replace("_", " ")} />
                    <span className="nav-pct">{p.stats?.percent ?? 0}%</span>
                  </span>,
                  p._id
                )
              )}

              <div className="nav-heading">Channels</div>
              {channels.length === 0 && <div className="nav-empty">No channels yet</div>}
              {channels.map((c) => item(`${base}/chat/${c._id}`, c.name, pathname.endsWith(`/chat/${c._id}`), null, <span className="nav-hash">#</span>, c._id))}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className={`user-card ${pathname === "/app/account" ? "active" : ""}`}>
            <Link className="user-card-main" href="/app/account">
              <span className="avatar-wrap">
                <Avatar user={user} size={34} />
                <span className={`dot status ${disconnected ? "" : "on"}`} title={disconnected ? "Offline" : "Connected"} />
              </span>
              <span className="user-meta">
                <strong>{user.name}</strong>
                <span className="muted">{user.email}</span>
              </span>
            </Link>
            <button className="sidebar-signout" onClick={() => setLogoutOpen(true)} aria-label="Sign out" title="Sign out">
              <span aria-hidden="true">↪</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
        {disconnected && (
          <div className="banner offline" role="status">
            You are offline or the realtime connection dropped. Changes still save; live updates resume on reconnect.
          </div>
        )}
        <header className="appbar">
          <button className="btn secondary icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Open menu">
            ☰
          </button>
          <Link className="appbar-title" href="/app">
            <Logo compact />
          </Link>
          <div className="appbar-actions">
            <button
              className="btn secondary icon-btn"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title="Toggle theme"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <div className="bell">
              <button className="btn secondary" onClick={toggleBell} aria-expanded={open}>
                Alerts
              </button>
              {unread > 0 && <span className="badge">{unread}</span>}
              {open && (
                <div className="note-list" role="menu">
                  {notifications.length === 0 && <div className="muted note-empty">You&apos;re all caught up</div>}
                  {notifications.map((n) => {
                    const body = (
                      <>
                        <strong>{n.title}</strong>
                        <div className="muted">{n.body}</div>
                        {n.createdAt && <div className="muted">{timeAgo(n.createdAt)}</div>}
                      </>
                    );
                    const cls = `note ${n.read ? "" : "unread"}`;
                    return n.link ? (
                      <Link key={n.id || n._id} className={cls} href={n.link}>
                        {body}
                      </Link>
                    ) : (
                      <div key={n.id || n._id} className={cls}>
                        {body}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="profile-menu-wrap">
              <button
                className="profile-trigger"
                onClick={() => setProfileMenu((value) => !value)}
                aria-expanded={profileMenu}
                aria-haspopup="menu"
                aria-label="Open account menu"
              >
                <Avatar user={user} size={34} />
                <span className="profile-trigger-copy">
                  <strong>{user.name}</strong>
                  <span>Account</span>
                </span>
                <span className="profile-chevron" aria-hidden="true">⌄</span>
              </button>
              {profileMenu && (
                <div className="profile-menu" role="menu">
                  <div className="profile-menu-head">
                    <Avatar user={user} size={42} />
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  <div className="profile-menu-divider" />
                  <Link href="/app/account" className="profile-menu-item" role="menuitem">
                    <span className="profile-menu-icon">◎</span>
                    <span><strong>Profile & settings</strong><small>Manage your account</small></span>
                  </Link>
                  <button className="profile-menu-item danger-item" onClick={() => setLogoutOpen(true)} role="menuitem">
                    <span className="profile-menu-icon">↪</span>
                    <span><strong>Sign out</strong><small>End this session</small></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      {logoutOpen && (
        <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <button className="scrim" onClick={() => !loggingOut && setLogoutOpen(false)} aria-label="Close sign out dialog" />
          <div className="confirm-modal">
            <div className="confirm-icon" aria-hidden="true">↪</div>
            <h2 id="logout-title">Sign out of CollabBoard?</h2>
            <p className="muted">You’ll need to sign in again to access your workspaces and notifications.</p>
            <div className="confirm-actions">
              <button className="btn secondary" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>Cancel</button>
              <button className="btn danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
