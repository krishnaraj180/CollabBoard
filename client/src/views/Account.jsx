"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "../api";
import AppShell from "../components/AppShell";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";

const COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#059669", "#d97706", "#475569"];

export default function Account() {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState({ name: user?.name || "", avatarColor: user?.avatarColor || COLORS[0] });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function flash(message) {
    setNotice(message);
    setError("");
    setTimeout(() => setNotice(""), 3500);
  }

  async function saveProfile(e) {
    e.preventDefault();
    try {
      const data = await api("/api/auth/me", { method: "PATCH", body: { name: profile.name.trim(), avatarColor: profile.avatarColor } });
      setUser(data.user);
      flash("Profile saved");
    } catch (err) {
      setError(err.message);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    try {
      const data = await api("/api/auth/password", { method: "POST", body: pw });
      if (data.token) setToken(data.token);
      setPw({ currentPassword: "", newPassword: "" });
      flash("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(err.details?.[0]?.message ? `${err.message}: ${err.details[0].message}` : err.message);
    }
  }

  async function signOutAllDevices() {
    try {
      await api("/api/auth/sessions/revoke", { method: "POST" });
      setToken(null);
      setUser(null);
      router.replace("/login");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div className="grow">
          <h1>Account</h1>
          <p className="muted">Your profile and sign-in settings.</p>
        </div>
      </div>
      <section className="account-hero">
        <div className="account-hero-avatar"><Avatar user={user} size={72} /></div>
        <div className="grow">
          <span className="eyebrow">Personal account</span>
          <h2>{user?.name}</h2>
          <p className="muted">Signed in as {user?.email}</p>
        </div>
        <div className="account-status"><span className="dot on" /> Active session</div>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {user && (
        <div className="account-grid">
          <section className="box">
            <h3>Profile</h3>
            <div className="profile-preview">
              <Avatar user={{ ...user, name: profile.name || user.name, avatarColor: profile.avatarColor }} size={64} />
              <div>
                <strong>{profile.name || user.name}</strong>
                <div className="muted">{user.email}</div>
              </div>
            </div>
            <form className="col-form" onSubmit={saveProfile}>
              <label className="field">
                <span>Display name</span>
                <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required minLength={2} maxLength={80} />
              </label>
              <div className="field">
                <span>Avatar colour</span>
                <div className="swatches">
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`swatch ${profile.avatarColor === c ? "on" : ""}`}
                      style={{ background: c }}
                      onClick={() => setProfile({ ...profile, avatarColor: c })}
                      aria-label={`Use colour ${c}`}
                      aria-pressed={profile.avatarColor === c}
                    />
                  ))}
                </div>
              </div>
              <button className="btn">Save profile</button>
            </form>
          </section>

          <section className="box">
            <h3>Change password</h3>
            <form className="col-form" onSubmit={savePassword}>
              <label className="field">
                <span>Current password</span>
                <input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              </label>
              <label className="field">
                <span>New password</span>
                <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                <span className="hint">At least 8 characters. Changing it signs out your other devices.</span>
              </label>
              <button className="btn">Update password</button>
            </form>
            <div className="security-action">
              <div><strong>Sign out all devices</strong><span className="hint">End every active session, including this one.</span></div>
              <button type="button" className="btn secondary" onClick={signOutAllDevices}>Sign out everywhere</button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
