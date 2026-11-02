"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { useRealtime } from "../context/RealtimeContext";
import { formatDate } from "../lib/format";

export default function MyTasks() {
  const { workspaceId } = useParams();
  const { socket } = useRealtime();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDone, setShowDone] = useState(false);

  async function load() {
    try {
      const data = await api(`/api/workspaces/${workspaceId}/my-tasks`);
      setTasks(data.tasks);
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

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => load();
    socket.on("task:updated", refresh);
    return () => socket.off("task:updated", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, workspaceId]);

  const groups = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const week = Date.now() + 7 * 24 * 3600 * 1000;
    return [
      ["Overdue", open.filter((t) => t.overdue), "bad"],
      ["Due this week", open.filter((t) => !t.overdue && t.dueDate && new Date(t.dueDate).getTime() <= week), ""],
      ["Later", open.filter((t) => !t.overdue && t.dueDate && new Date(t.dueDate).getTime() > week), ""],
      ["No due date", open.filter((t) => !t.dueDate), ""],
    ];
  }, [tasks]);
  const done = tasks.filter((t) => t.done);

  async function complete(task) {
    if (!task.doneColumnId) return;
    setTasks((list) => list.map((t) => (t._id === task._id ? { ...t, done: true } : t)));
    try {
      await api(`/api/projects/${task.project._id}/tasks/${task._id}`, { method: "PATCH", body: { columnId: task.doneColumnId } });
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  const row = (t) => (
    <li className={`mytask ${t.done ? "is-done" : ""}`} key={t._id}>
      <button
        className={`tick ${t.done ? "on" : ""}`}
        onClick={() => !t.done && complete(t)}
        disabled={t.done}
        aria-label={t.done ? "Completed" : `Mark ${t.title} complete`}
      >
        {t.done ? "✓" : ""}
      </button>
      <div className="grow">
        <div className={t.done ? "struck" : ""}>{t.title}</div>
        <div className="muted">
          <Link href={`/app/w/${workspaceId}/projects/${t.project._id}`}>{t.project.name}</Link> · {t.columnTitle}
        </div>
      </div>
      <span className={`prio-tag ${t.priority}`}>{t.priority}</span>
      {t.dueDate && <span className={`due ${t.overdue ? "overdue" : ""}`}>{formatDate(t.dueDate)}</span>}
    </li>
  );

  return (
    <AppShell workspaceId={workspaceId}>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="page-head">
        <div className="grow">
          <h1>My tasks</h1>
          <p className="muted">Everything assigned to you in this workspace, most urgent first.</p>
        </div>
      </div>
      {loading && <div className="skeleton" />}
      {!loading && tasks.length === 0 && <div className="empty">Nothing is assigned to you yet.</div>}
      {groups.map(
        ([label, items, tone]) =>
          items.length > 0 && (
            <section className="box" key={label}>
              <h3 className={tone}>
                {label} <span className="count">{items.length}</span>
              </h3>
              <ul className="mytasks">{items.map(row)}</ul>
            </section>
          )
      )}
      {done.length > 0 && (
        <section className="box">
          <h3>
            Completed <span className="count">{done.length}</span>{" "}
            <button className="link-btn" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"}
            </button>
          </h3>
          {showDone && <ul className="mytasks">{done.map(row)}</ul>}
        </section>
      )}
    </AppShell>
  );
}
