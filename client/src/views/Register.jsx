"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

export default function Register() {
  const { user, register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
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
      await register({ ...form, name: form.name.trim(), email: form.email.trim() });
      router.push("/app");
    } catch (err) {
      setError(err.details?.[0]?.message ? `${err.message}: ${err.details[0].message}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  const score = strength(form.password);
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start a workspace for your team in under a minute."
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="auth-form-body">
        {error && <div className="auth-error-banner" role="alert">{error}</div>}
        <div className="form-group">
          <label>Full Name</label>
          <input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alex Rivera" />
        </div>
        <div className="form-group">
          <label>Work Email</label>
          <input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alex@company.com" />
        </div>
        <div className="form-group">
          <label>Password</label>
          <div className="input-row">
            <input required minLength={8} maxLength={72} type={show ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
            <button type="button" className="link-btn" onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
          </div>
          {form.password && (
            <div className="strength" aria-live="polite">
              <div className={`strength-bar s${score}`}><span /><span /><span /><span /></div>
              <span className="muted">{labels[score]}</span>
            </div>
          )}
          <span className="hint">At least 8 characters.</span>
        </div>
        <button className="auth-submit-btn" disabled={busy}>{busy ? "Creating account…" : "Create Workspace Account →"}</button>
      </form>
    </AuthLayout>
  );
}
