"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";

const COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#059669", "#d97706", "#475569"];
const defaults = { emailNotifications: true, inAppNotifications: true, theme: "system", compactAccountDisplay: false };
const date = (value) => value ? new Date(value).toLocaleString() : "Unknown";

export default function Account() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name || "", email: user?.email || "", avatarColor: user?.avatarColor || COLORS[0], avatarUrl: user?.avatarUrl || "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [preferences, setPreferences] = useState({ ...defaults, ...(user?.preferences || {}) });
  const [sessions, setSessions] = useState([]);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user) return;
    setProfile({ name: user.name || "", email: user.email || "", avatarColor: user.avatarColor || COLORS[0], avatarUrl: user.avatarUrl || "" });
    setPreferences({ ...defaults, ...(user.preferences || {}) });
    api("/api/auth/sessions").then((data) => setSessions(data.sessions)).catch((err) => setError(err.message));
  }, [user]);
  const flash = (message) => { setNotice(message); setError(""); window.setTimeout(() => setNotice(""), 4000); };
  const fail = (err) => setError(err.details?.[0]?.message ? `${err.message}: ${err.details[0].message}` : err.message);

  async function saveProfile(event) {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy("profile");
    try { const data = await api("/api/auth/me", { method: "PATCH", body: { name: profile.name.trim(), email: profile.email.trim(), avatarColor: profile.avatarColor, avatarUrl: profile.avatarUrl.trim() || null } }); setUser(data.user); flash(data.message || "Profile saved"); }
    catch (err) { fail(err); } finally { inFlight.current = false; setBusy(""); }
  }
  async function savePassword(event) {
    event.preventDefault(); if (pw.newPassword !== pw.confirmPassword) return setError("New password and confirmation do not match"); if (inFlight.current) return; inFlight.current = true; setBusy("password");
    try { await api("/api/auth/password", { method: "POST", body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } }); setPw({ currentPassword: "", newPassword: "", confirmPassword: "" }); setSessions([]); flash("Password changed. Other devices were signed out."); }
    catch (err) { fail(err); } finally { inFlight.current = false; setBusy(""); }
  }
  async function savePreferences(event) {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy("preferences");
    try { const data = await api("/api/auth/preferences", { method: "PATCH", body: preferences }); setUser({ ...user, preferences: data.preferences }); if (preferences.theme !== "system") { document.documentElement.dataset.theme = preferences.theme; localStorage.setItem("cb_theme", preferences.theme); } flash("Preferences saved"); }
    catch (err) { fail(err); } finally { inFlight.current = false; setBusy(""); }
  }
  async function revokeSession(id) { if (!window.confirm("Sign out this device?")) return; try { await api(`/api/auth/sessions/${id}`, { method: "DELETE" }); setSessions((list) => list.filter((session) => session.id !== id)); flash("Session signed out"); } catch (err) { fail(err); } }
  async function signOutEverywhere() { if (!window.confirm("Sign out all devices, including this one?")) return; setBusy("revoke"); try { await api("/api/auth/logout-all", { method: "POST" }); setUser(null); } catch (err) { fail(err); } finally { setBusy(""); } }

  return <AppShell>
    <div className="page-head"><div className="grow"><h1>Account settings</h1><p className="muted">Manage your profile, security, and notification preferences.</p></div></div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {user && <>
      <section className="account-hero"><div className="account-hero-avatar"><Avatar user={{ ...user, ...profile }} size={72} /></div><div className="grow"><span className="eyebrow">Personal account</span><h2>{profile.name}</h2><p className="muted">{profile.email} {user.emailVerified ? "· Verified" : "· Verification pending"}</p></div><div className="account-status"><span className="dot on" /> Active session</div></section>
      <div className="account-grid">
        <section className="box"><h3>Profile information</h3><form className="col-form" onSubmit={saveProfile}><label className="field"><span>Full name</span><input value={profile.name} minLength={2} maxLength={80} required onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label><label className="field"><span>Email address</span><input type="email" value={profile.email} required onChange={(e) => setProfile({ ...profile, email: e.target.value })} /><span className="hint">Changing email sends a verification link to the new address.</span></label><div className="field"><span>Profile picture / avatar colour</span><div className="swatches">{COLORS.map((color) => <button type="button" key={color} className={`swatch ${profile.avatarColor === color ? "on" : ""}`} style={{ background: color }} onClick={() => setProfile({ ...profile, avatarColor: color })} aria-label={`Use colour ${color}`} />)}</div></div><label className="field"><span>Avatar image URL (optional)</span><input type="url" placeholder="https://…" value={profile.avatarUrl} onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })} /></label><button className="btn" disabled={busy === "profile"}>{busy === "profile" ? "Saving…" : "Save profile"}</button></form></section>
        <section className="box"><h3>Change password</h3><form className="col-form" onSubmit={savePassword}><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /><span className="hint">At least 8 characters. Other devices will be signed out.</span></label><label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" required value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} /></label><button className="btn" disabled={busy === "password"}>{busy === "password" ? "Updating…" : "Update password"}</button></form></section>
        <section className="box"><h3>Account security</h3><p className="muted">End every active session, including this one.</p><button className="btn secondary" onClick={signOutEverywhere} disabled={busy === "revoke"}>{busy === "revoke" ? "Signing out…" : "Sign out everywhere"}</button></section>
        <section className="box"><h3>Active sessions</h3>{sessions.length === 0 && <p className="muted">No tracked sessions yet.</p>}{sessions.map((session) => <div className="session-row" key={session.id}><div><strong>{session.current ? "This device" : session.userAgent}</strong><div className="hint">Created {date(session.createdAt)} · Active {date(session.lastActivityAt)}</div><div className="hint">{session.current ? session.userAgent : session.ipAddress}</div></div>{!session.current && <button className="btn secondary" onClick={() => revokeSession(session.id)}>Sign out</button>}</div>)}</section>
        <section className="box"><h3>Notification preferences</h3><form className="col-form" onSubmit={savePreferences}><label className="checkbox-label"><input type="checkbox" checked={preferences.emailNotifications} onChange={(e) => setPreferences({ ...preferences, emailNotifications: e.target.checked })} /> Email notifications</label><label className="checkbox-label"><input type="checkbox" checked={preferences.inAppNotifications} onChange={(e) => setPreferences({ ...preferences, inAppNotifications: e.target.checked })} /> In-app notifications</label><label className="field"><span>Appearance</span><select value={preferences.theme} onChange={(e) => setPreferences({ ...preferences, theme: e.target.value })}><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="checkbox-label"><input type="checkbox" checked={preferences.compactAccountDisplay} onChange={(e) => setPreferences({ ...preferences, compactAccountDisplay: e.target.checked })} /> Compact account display</label><button className="btn" disabled={busy === "preferences"}>{busy === "preferences" ? "Saving…" : "Save preferences"}</button></form></section>
      </div>
    </>}
  </AppShell>;
}
