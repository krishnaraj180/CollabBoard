"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { ActivityFeed, Avatar, ProgressBar, StatCard, StatusBadge } from "../components/ui";
import { useRealtime } from "../context/RealtimeContext";
import { PROJECT_STATUS, formatDate, roleLabel } from "../lib/format";

const FILTERS = [["all", "All"], ...Object.entries(PROJECT_STATUS).map(([id, m]) => [id, m.label])];
const ACTIVITY_FILTERS = [["all", "All"], ["projects", "Projects"], ["tasks", "Tasks"], ["team", "Team"]];

function activityCategory(item) {
  if (item.action?.startsWith("project.")) return "projects";
  if (item.action?.startsWith("task.")) return "tasks";
  return "team";
}

export default function Workspace() {
  const { workspaceId } = useParams();
  const { socket, onlineUserIds } = useRealtime();
  const [workspace, setWorkspace] = useState(null);
  const [dash, setDash] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activityItems, setActivityItems] = useState([]);
  const [activityFilter, setActivityFilter] = useState("all");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ name: "", description: "", dueDate: "" });
  const [channelName, setChannelName] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [ws, d, ch] = await Promise.all([
        api(`/api/workspaces/${workspaceId}`),
        api(`/api/workspaces/${workspaceId}/dashboard`),
        api(`/api/workspaces/${workspaceId}/channels`),
      ]);
      setWorkspace(ws.workspace);
      setDash(d);
      setActivityItems(d.activity || []);
      setChannels(ch.channels);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Any project or task change in the workspace refreshes the numbers; activity is appended directly.
  useEffect(() => {
    if (!socket) return undefined;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api(`/api/workspaces/${workspaceId}/dashboard`).then(setDash).catch(() => {});
      }, 400);
    };
    const onActivity = (a) => {
      if (a.workspace !== workspaceId) return;
      setActivityItems((items) => [a, ...items.filter((item) => item._id !== a._id)].slice(0, 50));
      setDash((d) => (d ? { ...d, activity: [a, ...d.activity].slice(0, 15) } : d));
    };
    ["task:updated", "project:created", "project:updated", "project:deleted"].forEach((e) => socket.on(e, refresh));
    socket.on("activity:new", onActivity);
    return () => {
      clearTimeout(timer);
      ["task:updated", "project:created", "project:updated", "project:deleted"].forEach((e) => socket.off(e, refresh));
      socket.off("activity:new", onActivity);
    };
  }, [socket, workspaceId]);

  const isManager = dash && ["owner", "admin", "ceo", "managing_director"].includes(dash.myRole);
  const canCreateProject = isManager || dash?.myRole === "project_manager";

  async function addProject(e) {
    e.preventDefault();
    try {
      await api(`/api/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: {
          name: form.name,
          description: form.description,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        },
      });
      setForm({ name: "", description: "", dueDate: "" });
      const d = await api(`/api/workspaces/${workspaceId}/dashboard`);
      setDash(d);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addChannel(e) {
    e.preventDefault();
    try {
      const data = await api(`/api/workspaces/${workspaceId}/channels`, { method: "POST", body: { name: channelName } });
      setChannels((c) => [...c, data.channel]);
      setChannelName("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAllActivity() {
    if (showAllActivity) {
      setShowAllActivity(false);
      return;
    }
    if (activityItems.length < 50) {
      setActivityLoading(true);
      try {
        const data = await api(`/api/workspaces/${workspaceId}/activity`);
        setActivityItems(data.activity || []);
      } catch (err) {
        setError(err.message);
        return;
      } finally {
        setActivityLoading(false);
      }
    }
    setShowAllActivity(true);
  }

  const projects = dash ? dash.projects.filter((p) => filter === "all" || p.status === filter) : [];
  const filteredActivity = activityItems.filter((item) => activityFilter === "all" || activityCategory(item) === activityFilter);
  const visibleActivity = showAllActivity ? filteredActivity : filteredActivity.slice(0, 5);

  return (
    <AppShell workspaceId={workspaceId} channels={channels}>
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="skeleton" />}
      {workspace && dash && (
        <>
          <div className="page-head">
            <div className="grow">
              <h1>{workspace.name}</h1>
              <p className="muted">{workspace.description || "Projects, chat, and people in one room."}</p>
            </div>
            <span className="role-pill">{roleLabel(dash.myRole)}</span>
          </div>

          <div className="stats-row">
            <StatCard label="Projects" value={dash.totals.projects} />
            <StatCard label="Open tasks" value={dash.totals.open} />
            <StatCard label="Completed" value={`${dash.totals.percent}%`} tone="good" hint={`${dash.totals.completed} of ${dash.totals.tasks} tasks`} />
            <StatCard label="Overdue" value={dash.totals.overdue} tone={dash.totals.overdue ? "bad" : ""} />
          </div>

          <div className="split">
            <section>
              <div className="section-head">
                <h2>Projects</h2>
                <div className="seg" role="tablist" aria-label="Filter projects by status">
                  {FILTERS.map(([id, label]) => (
                    <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
                      {label}
                      {id !== "all" && <span className="count">{dash.statusCounts[id] || 0}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {canCreateProject && <details className="new-project">
                <summary className="btn secondary">+ New project</summary>
                <form className="panel-form" onSubmit={addProject}>
                  <label className="field">
                    <span>Name</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} />
                  </label>
                  <label className="field">
                    <span>Goal / description</span>
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={400} />
                  </label>
                  <label className="field">
                    <span>Target date</span>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                  </label>
                  <button className="btn">Create project</button>
                </form>
              </details>}

              {projects.length === 0 && (
                <div className="empty">{dash.projects.length === 0 ? "No projects yet. Create the first one above." : "No projects with this status."}</div>
              )}
              <div className="grid-cards">
                {projects.map((p) => (
                  <Link className="card project-card" key={p._id} href={`/app/w/${workspaceId}/projects/${p._id}`}>
                    <div className="card-top">
                      <h3>{p.name}</h3>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="muted">{p.description || "Kanban board"}</p>
                    <p className="muted">Workflow: {(p.workflowStage || "business_approval").replace(/_/g, " ")}</p>
                    <ProgressBar percent={p.stats.percent} label={`${p.name} progress`} />
                    <div className="card-foot">
                      <span>
                        <strong>{p.stats.percent}%</strong> · {p.stats.completed}/{p.stats.total} done
                      </span>
                      {p.dueDate && <span className={`due ${p.overdue ? "overdue" : ""}`}>{formatDate(p.dueDate)}</span>}
                    </div>
                    {p.stats.overdue > 0 && <div className="due overdue">{p.stats.overdue} overdue task{p.stats.overdue > 1 ? "s" : ""}</div>}
                  </Link>
                ))}
              </div>
            </section>

            <aside className="side-col">
              <section className="box">
                <h3>Team workload</h3>
                {dash.workload.map((w) => {
                  const total = w.open + w.done;
                  const online = onlineUserIds.includes(String(w.user._id));
                  return (
                    <div className="workload-row" key={w.user._id}>
                      <div className="who">
                        <Avatar user={w.user} size={26} />
                        <span className={`dot ${online ? "on" : ""}`} title={online ? "Online" : "Offline"} />
                        <strong>{w.user.name}</strong>
                        <span className="muted">{roleLabel(w.role)}</span>
                      </div>
                      <ProgressBar percent={total ? Math.round((w.done / total) * 100) : 0} label={`${w.user.name} completion`} />
                      <div className="muted">
                        {w.open} open · {w.done} done{w.overdue ? ` · ${w.overdue} overdue` : ""}
                      </div>
                    </div>
                  );
                })}
                <Link className="btn secondary block" href={`/app/w/${workspaceId}/team`}>
                  {isManager ? "Manage team & roles" : "View team"}
                </Link>
              </section>

              <section className="box activity-panel">
                <div className="activity-head">
                  <div>
                    <h3>Recent activity</h3>
                    <p className="muted">A read-only timeline of workspace updates.</p>
                  </div>
                  <span className="activity-total">{filteredActivity.length}</span>
                </div>
                <div className="activity-filters" role="tablist" aria-label="Filter activity">
                  {ACTIVITY_FILTERS.map(([id, label]) => (
                    <button key={id} className={activityFilter === id ? "on" : ""} onClick={() => setActivityFilter(id)} role="tab" aria-selected={activityFilter === id}>
                      {label}
                    </button>
                  ))}
                </div>
                <ActivityFeed items={visibleActivity} />
                {activityItems.length > 5 && (
                  <button className="activity-more" onClick={toggleAllActivity} disabled={activityLoading}>
                    {activityLoading ? "Loading…" : showAllActivity ? "Show less" : "View all activity"}
                  </button>
                )}
              </section>

              <section className="box">
                <h3>Group chats</h3>
                <form className="stack nowrap" onSubmit={addChannel}>
                  <input placeholder="New channel" value={channelName} onChange={(e) => setChannelName(e.target.value)} minLength={2} required />
                  <button className="btn secondary">Create</button>
                </form>
                <div className="channel-list">
                  {channels.map((c) => (
                    <Link className="nav-chip" key={c._id} href={`/app/w/${workspaceId}/chat/${c._id}`}>
                      # {c.name}
                    </Link>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  );
}
