"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthLayout from "../components/AuthLayout";
import { api } from "../api";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password/reset", { method: "POST", body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create a new password" subtitle="Choose a strong password for your CollabBoard account." footer={<><Link href="/login">Back to sign in</Link></>}>
      {done ? (
        <div className="auth-success-panel" role="status"><strong>Password updated</strong><p>Your password has been changed and other sessions have been signed out.</p><Link className="btn" href="/login">Sign in</Link></div>
      ) : (
        <form className="auth-form-body" onSubmit={submit}>
          {error && <div className="auth-error-banner" role="alert">{error}</div>}
          {!token && <div className="auth-error-banner" role="alert">This reset link is missing or invalid. Request a new one.</div>}
          <div className="form-group"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="form-group"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <button className="auth-submit-btn" disabled={busy || !token}>{busy ? "Updating…" : "Update password"}</button>
        </form>
      )}
    </AuthLayout>
  );
}
