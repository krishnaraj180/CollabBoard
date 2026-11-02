"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../api";
import AppShell from "../components/AppShell";
import TaskDrawer from "../components/TaskDrawer";
import { ActivityFeed, AvatarStack, ProgressBar, StatCard, StatusBadge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { PRIORITIES, PROJECT_STATUS, dueTone, formatDate, isDoneColumn, toInputDate } from "../lib/format";

function computeStats(project, tasks) {
  const total = tasks.length;
  let completed = 0;
  let overdue = 0;
  tasks.forEach((t) => {
    const done = isDoneColumn(project, t.columnId);
    if (done) completed += 1;
    else if (t.dueDate && new Date(t.dueDate) < new Date()) overdue += 1;
  });
  return { total, completed, open: total - completed, overdue, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export default function Board() {
  const { workspaceId, projectId } = useParams();
  const { user } = useAuth();
  const { socket } = useRealtime();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [myRole, setMyRole] = useState("member");
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [openId, setOpenId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [filters, setFilters] = useState({ q: "", assignee: "", priority: "", hideDone: false });
  const [tab, setTab] = useState("board");

  const isManager = myRole === "owner" || myRole === "admin";
  const canEdit = myRole !== "viewer";

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [board, ws, act] = await Promise.all([
        api(`/api/projects/${projectId}`),
        api(`/api/workspaces/${workspaceId}`),
        api(`/api/projects/${projectId}/activity`),
      ]);
      setProject(board.project);
      setTasks(board.tasks);
      setMyRole(board.myRole);
      setMembers(ws.workspace.members.map((m) => m.user).filter(Boolean));
      setActivity(act.activity);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!socket) return undefined;
    function onTask(payload) {
      if (payload.projectId !== projectId) return;
      if (payload.type === "deleted") {
        setTasks((list) => list.filter((t) => t._id !== payload.taskId));
        setOpenId((id) => (id === payload.taskId ? null : id));
        return;
      }
      setTasks((list) => {
        const exists = list.some((t) => t._id === payload.task._id);
        return exists ? list.map((t) => (t._id === payload.task._id ? payload.task : t)) : [...list, payload.task];
      });
    }
    function onProject({ project: next }) {
      if (next._id === projectId) setProject((p) => ({ ...p, ...next }));
    }
    function onDeleted({ projectId: id }) {
      if (id === projectId) router.replace(`/app/w/${workspaceId}`);
    }
    function onActivity(a) {
      if (a.project === projectId) setActivity((list) => [a, ...list].slice(0, 40));
    }
    socket.on("task:updated", onTask);
    socket.on("project:updated", onProject);
    socket.on("project:deleted", onDeleted);
    socket.on("activity:new", onActivity);
    return () => {
      socket.off("task:updated", onTask);
      socket.off("project:updated", onProject);
      socket.off("project:deleted", onDeleted);
      socket.off("activity:new", onActivity);
    };
  }, [socket, projectId, workspaceId, router]);

  const stats = useMemo(() => (project ? computeStats(project, tasks) : null), [project, tasks]);
  const myId = user?._id || user?.id;

  const visible = useMemo(() => {
    if (!project) return [];
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !`${t.title} ${(t.labels || []).join(" ")}`.toLowerCase().includes(q)) return false;
      if (filters.assignee === "me" && !t.assignees?.some((a) => a._id === myId)) return false;
      if (filters.assignee === "none" && t.assignees?.length) return false;
      if (filters.assignee && !["me", "none"].includes(filters.assignee) && !t.assignees?.some((a) => a._id === filters.assignee)) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.hideDone && isDoneColumn(project, t.columnId)) return false;
      return true;
    });
  }, [tasks, filters, project, myId]);

  const filtering = Boolean(filters.q || filters.assignee || filters.priority || filters.hideDone);

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api(`/api/projects/${projectId}/tasks`, { method: "POST", body: { title: title.trim(), priority } });
      setTitle("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function moveTask(taskId, columnId) {
    const task = tasks.find((t) => t._id === taskId);
    if (!task || task.columnId === columnId) return;
    // optimistic: the socket echo replaces this with the server copy
    setTasks((list) => list.map((t) => (t._id === taskId ? { ...t, columnId } : t)));
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: { columnId } });
    } catch (err) {
      setTasks((list) => list.map((t) => (t._id === taskId ? task : t)));
      setError(err.message);
    }
  }

  async function patchProject(patch) {
    try {
      const data = await api(`/api/projects/${projectId}`, { method: "PATCH", body: patch });
      setProject((p) => ({ ...p, ...data.project }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete “${project.name}” and all ${tasks.length} tasks? This cannot be undone.`)) return;
    try {
      await api(`/api/projects/${projectId}`, { method: "DELETE" });
      router.replace(`/app/w/${workspaceId}`);
    } catch (err) {
      setError(err.message);
    }
  }

  const openTask = tasks.find((t) => t._id === openId);
  const canDeleteTask = (t) => isManager || t.createdBy?._id === myId;

  return (
    <AppShell workspaceId={workspaceId}>
      {error && (
        <div className="error" role="alert">
          {error} <button className="link-btn" onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {loading && <div className="skeleton" />}
      {project && stats && (
        <>
          <div className="crumbs">
            <Link href={`/app/w/${workspaceId}`}>Dashboard</Link> / <span>{project.name}</span>
          </div>
          <div className="page-head">
            <div className="grow">
              <h1>{project.name}</h1>
              <p className="muted">{project.description || "Move cards across columns as work progresses."}</p>
              <div className="meta-row">
                <StatusBadge status={project.status} />
                {project.dueDate && (
                  <span className={`due ${project.overdue ? "overdue" : ""}`}>
                    Due {formatDate(project.dueDate)}
                    {project.overdue ? " · overdue" : ""}
                  </span>
                )}
              </div>
            </div>
            {isManager && (
              <div className="admin-box">
                <div className="muted">Admin controls</div>
                <label className="field inline">
                  <span>Status</span>
                  <select value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                    {Object.entries(PROJECT_STATUS).map(([id, m]) => (
                      <option key={id} value={id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field inline">
                  <span>Due</span>
                  <input
                    type="date"
                    value={toInputDate(project.dueDate)}
                    onChange={(e) => patchProject({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  />
                </label>
                <button className="btn danger" onClick={deleteProject}>
                  Delete project
                </button>
              </div>
            )}
          </div>

          <div className="stats-row">
            <StatCard label="Complete" value={`${stats.percent}%`} tone="accent" />
            <StatCard label="Open tasks" value={stats.open} />
            <StatCard label="Done" value={stats.completed} tone="good" />
            <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue ? "bad" : ""} />
          </div>
          <ProgressBar percent={stats.percent} label="Project completion" />

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "board"} className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>
              Board
            </button>
            <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>
              Activity
            </button>
          </div>

          {tab === "activity" && <ActivityFeed items={activity} />}

          {tab === "board" && (
            <>
              {canEdit && (
                <form className="add-task" onSubmit={addTask}>
                  <input placeholder="Add a task and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} aria-label="New task title" />
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                    {PRIORITIES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn">Add</button>
                </form>
              )}

              <div className="filters">
                <input
                  type="search"
                  placeholder="Search tasks or labels"
                  value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                  aria-label="Search tasks"
                />
                <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} aria-label="Filter by assignee">
                  <option value="">Everyone</option>
                  <option value="me">Assigned to me</option>
                  <option value="none">Unassigned</option>
                  {members.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Filter by priority">
                  <option value="">Any priority</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input type="checkbox" checked={filters.hideDone} onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })} /> Hide done
                </label>
                {filtering && (
                  <button className="link-btn" onClick={() => setFilters({ q: "", assignee: "", priority: "", hideDone: false })}>
                    Clear
                  </button>
                )}
              </div>

              <div className="kanban" style={{ "--cols": project.columns.length }}>
                {[...project.columns]
                  .sort((a, b) => a.order - b.order)
                  .map((col) => {
                    const items = visible.filter((t) => t.columnId === col.id).sort((a, b) => a.order - b.order);
                    return (
                      <section
                        className={`column ${dragOver === col.id ? "drag-over" : ""}`}
                        key={col.id}
                        aria-label={col.title}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(col.id);
                        }}
                        onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
                        onDrop={(e) => {
                          const id = e.dataTransfer.getData("text/plain");
                          setDragOver(null);
                          if (id) moveTask(id, col.id);
                        }}
                      >
                        <h3>
                          {col.title} <span className="count">{items.length}</span>
                        </h3>
                        {items.length === 0 && <div className="empty">{filtering ? "No matches." : "Nothing here."}</div>}
                        {items.map((task) => {
                          const done = isDoneColumn(project, task.columnId);
                          const tone = dueTone(task.dueDate, done);
                          const checkTotal = task.checklist?.length || 0;
                          const checkDone = task.checklist?.filter((c) => c.done).length || 0;
                          return (
                            <article
                              className={`task prio-${task.priority || "medium"} ${done ? "is-done" : ""}`}
                              key={task._id}
                              draggable={canEdit}
                              onDragStart={(e) => canEdit && e.dataTransfer.setData("text/plain", task._id)}
                              onClick={() => setOpenId(task._id)}
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") setOpenId(task._id);
                              }}
                            >
                              <div className="task-top">
                                <h4>{task.title}</h4>
                                <span className={`prio-tag ${task.priority || "medium"}`}>{task.priority || "medium"}</span>
                              </div>
                              {task.labels?.length > 0 && (
                                <div>
                                  {task.labels.map((l) => (
                                    <span className="chip" key={l}>
                                      {l}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="task-meta">
                                {task.dueDate && <span className={`due ${tone}`}>{formatDate(task.dueDate)}</span>}
                                {checkTotal > 0 && (
                                  <span className="muted">
                                    ☑ {checkDone}/{checkTotal}
                                  </span>
                                )}
                                {task.comments?.length > 0 && <span className="muted">💬 {task.comments.length}</span>}
                                <span className="grow" />
                                <AvatarStack users={task.assignees || []} />
                              </div>
                              {canEdit && (
                                <select
                                  className="move-select"
                                  value={task.columnId}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => moveTask(task._id, e.target.value)}
                                  aria-label={`Move ${task.title}`}
                                >
                                  {project.columns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      Move to: {c.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </article>
                          );
                        })}
                      </section>
                    );
                  })}
              </div>
            </>
          )}

          {openTask && (
            <TaskDrawer
              projectId={projectId}
              task={openTask}
              columns={project.columns}
              members={members}
              me={user}
              canDelete={canDeleteTask(openTask)}
              canEdit={canEdit}
              onClose={() => setOpenId(null)}
              onDeleted={() => setOpenId(null)}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
