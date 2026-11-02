"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useNav } from "../context/NavContext";

export default function Home() {
  const { user } = useAuth();
  const { reloadWorkspaces } = useNav();
  const myId = user?._id || user?.id;
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/workspaces");
      setWorkspaces(data.workspaces);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createWorkspace(e) {
    e.preventDefault();
    try {
      const data = await api("/api/workspaces", { method: "POST", body: { name } });
      setWorkspaces((w) => [data.workspace, ...w]);
      setName("");
      reloadWorkspaces();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div className="grow">
          <h1>Your workspaces</h1>
          <p className="muted">Pick a workspace to open its dashboard, or start a new one for another team.</p>
        </div>
      </div>
      <form className="inline-create" onSubmit={createWorkspace}>
        <input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} aria-label="Workspace name" />
        <button className="btn">Create workspace</button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="skeleton" />}
      {!loading && workspaces.length === 0 && <div className="empty">No workspaces yet. Create one to open boards and chat.</div>}
      <div className="grid-cards">
        {workspaces.map((ws) => {
          const mine = ws.members?.find((m) => (m.user?._id || m.user) === myId);
          return (
            <Link className="card project-card" key={ws._id} href={`/app/w/${ws._id}`}>
              <div className="card-top">
                <h3>{ws.name}</h3>
                {mine && <span className={`role-pill ${mine.role}`}>{mine.role}</span>}
              </div>
              <p className="muted">{ws.description || "Team workspace"}</p>
              <div className="card-foot">
                <span className="avatar-stack">
                  {(ws.members || []).slice(0, 4).map((m) => (
                    <Avatar key={m.user?._id} user={m.user} size={26} />
                  ))}
                </span>
                <span className="muted">{ws.members?.length || 0} member{ws.members?.length === 1 ? "" : "s"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
