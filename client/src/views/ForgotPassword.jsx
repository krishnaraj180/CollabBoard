"use client";

import { useState } from "react";
import Link from "next/link";
import AuthLayout from "../components/AuthLayout";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password/forgot", { method: "POST", body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll send a secure reset link to your account email." footer={<><Link href="/login">Back to sign in</Link></>}>
      {sent ? (
        <div className="auth-success-panel" role="status">
          <strong>Check your inbox</strong>
          <p>If an account matches that email, reset instructions are on their way. The link expires in 30 minutes.</p>
          <Link className="btn secondary" href="/login">Return to sign in</Link>
        </div>
      ) : (
        <form className="auth-form-body" onSubmit={submit}>
          {error && <div className="auth-error-banner" role="alert">{error}</div>}
          <div className="form-group">
            <label htmlFor="reset-email">Account email</label>
            <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <button className="auth-submit-btn" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <p className="auth-help-note">Don’t recognize the account? <a href="mailto:workspace-admin@collabboard.app">Contact your workspace admin</a>.</p>
        </form>
      )}
    </AuthLayout>
  );
}
