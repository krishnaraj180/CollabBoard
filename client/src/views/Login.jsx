"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/app");
  }, [user, router]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login({ ...form, email: form.email.trim() });
      router.push("/app");
    } catch (err) {
      setError(err.message || "Invalid email or password. Please verify your credentials.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in to CollabBoard"
      subtitle="Sign in with your email and password to access your workspaces."
      badge=""
      footer={<><>Don&apos;t have an account? </><Link href="/register">Create a workspace</Link></>}
    >
      <div className="auth-form-body">
        <form onSubmit={onSubmit} className="auth-email-form">
          {error && <div className="auth-error-banner" role="alert">{error}</div>}

          <div className="form-group">
            <label htmlFor="auth-email">Work Email</label>
            <div className="input-with-icon">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              <input id="auth-email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
            </div>
          </div>

          <div className="form-group">
            <div className="field-header"><label htmlFor="auth-password">Password</label><Link className="field-link" href="/forgot-password">Forgot password?</Link></div>
            <div className="input-with-icon">
              <svg className="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <input id="auth-password" type={show ? "text" : "password"} autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              <button type="button" className="password-toggle-btn" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
            </div>
          </div>

          <div className="auth-row-options">
            <label className="checkbox-label"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Remember for 30 days</span></label>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={busy}>
            {busy ? <span className="auth-btn-spinner"><span className="spinner-dot" /> Authenticating…</span> : <span>Sign In to CollabBoard &rarr;</span>}
          </button>
        </form>
        <p className="auth-help-note">Need access to a workspace? <a href="mailto:workspace-admin@collabboard.app">Contact your workspace admin</a>.</p>
        <p className="auth-terms-note">By signing in, you agree to the CollabBoard Terms of Service and Privacy Policy.</p>
      </div>
    </AuthLayout>
  );
}
