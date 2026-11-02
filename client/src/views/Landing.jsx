"use client";

import Link from "next/link";
import { Logo } from "../components/ui";
import { useAuth } from "../context/AuthContext";

const FEATURES = [
  { title: "Live kanban boards", text: "Drag cards between columns and every teammate sees it instantly — no refresh." },
  { title: "Project status & progress", text: "Planning, in progress, on hold, completed — with automatic completion percentages and overdue alerts." },
  { title: "Roles that matter", text: "Owners, admins and members. Admins steer projects and people; members focus on the work." },
  { title: "Team chat & files", text: "Channels with typing indicators and file sharing, right next to the board." },
  { title: "Notifications & activity", text: "Get told when you're assigned, mentioned in a comment or a task is finished." },
  { title: "Works on every screen", text: "Swipeable boards, touch-friendly controls and a light or dark theme." },
];

const STEPS = [
  ["Create a workspace", "One room for your team, projects and conversations."],
  ["Invite your team", "Add people by email and give them a role."],
  ["Plan and ship", "Break work into tasks, assign it and watch progress climb."],
];

export default function Landing() {
  const { user, loading } = useAuth();
  return (
    <div className="landing">
      <header className="land-nav">
        <Logo />
        <nav>
          {!loading && user ? (
            <Link className="btn" href="/app">Open app</Link>
          ) : (
            <>
              <Link className="btn secondary" href="/login">Sign in</Link>
              <Link className="btn" href="/register">Get started</Link>
            </>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Project collaboration, in real time</span>
          <h1>Get your team from idea to done — together.</h1>
          <p>
            CollabBoard brings tasks, status tracking, chat and people into one calm workspace.
            Everyone stays in sync, and admins always know where each project stands.
          </p>
          <div className="hero-cta">
            <Link className="btn lg" href={user ? "/app" : "/register"}>{user ? "Open your workspaces" : "Create a free workspace"}</Link>
            {!user && <Link className="btn secondary lg" href="/login">I have an account</Link>}
          </div>
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="mock">
            <div className="mock-bar"><span /><span /><span /></div>
            <div className="mock-cols">
              {[["To do", 2], ["In progress", 2], ["Done", 1]].map(([t, n], c) => (
                <div className="mock-col" key={t}>
                  <div className="mock-title">{t}</div>
                  {Array.from({ length: n }).map((_, i) => (
                    <div className={`mock-card c${(c + i) % 3}`} key={i}>
                      <div className="mock-line w80" />
                      <div className="mock-line w50" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mock-progress"><div style={{ width: "62%" }} /></div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <h2>Everything a project team needs</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="steps">
        <h2>Up and running in minutes</h2>
        <ol>
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="step-no">{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="cta-band">
        <h2>Ready to run your next project in one place?</h2>
        <Link className="btn lg light" href={user ? "/app" : "/register"}>{user ? "Open app" : "Create your account"}</Link>
      </section>

      <footer className="land-foot">
        <Logo compact />
        <span className="muted">© {new Date().getFullYear()} CollabBoard</span>
      </footer>
    </div>
  );
}
