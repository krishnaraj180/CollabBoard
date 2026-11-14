"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Avatar } from "./ui";
import { PRIORITIES, formatDateTime, toInputDate } from "../lib/format";

function draftFrom(task) {
  return {
    title: task.title,
    description: task.description || "",
    columnId: task.columnId,
    priority: task.priority || "medium",
    startDate: toInputDate(task.startDate),
    dueDate: toInputDate(task.dueDate),
    progress: task.progress ?? 0,
    sprintId: task.sprint?._id || task.sprint || "",
    dependencies: (task.dependencies || []).map((dependency) => String(dependency?._id || dependency)),
    assignees: (task.assignees || []).map((a) => a._id),
    labels: (task.labels || []).join(", "),
    checklist: (task.checklist || []).map((c) => ({ _id: c._id, text: c.text, done: c.done })),
  };
}

/**
 * Side sheet (full screen on phones) for viewing and editing one task.
 * Field edits are batched behind "Save changes"; comments are posted immediately.
 */
export default function TaskDrawer({ projectId, task, columns, members, tasks = [], sprints = [], me, canDelete, canEdit = true, onClose, onDeleted }) {
  const [draft, setDraft] = useState(() => draftFrom(task));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");

  // Reset when a different task is opened; keep local edits when a teammate touches the same task.
  useEffect(() => {
    setDraft(draftFrom(task));
    setDirty(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task._id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function change(patch) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }

  function toggleAssignee(id) {
    change({
      assignees: draft.assignees.includes(id) ? draft.assignees.filter((a) => a !== id) : [...draft.assignees, id],
    });
  }

  function addItem(e) {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    change({ checklist: [...draft.checklist, { text, done: false }] });
    setNewItem("");
  }

  async function save() {
    if (draft.startDate && draft.dueDate && draft.startDate > draft.dueDate) {
      setError("Task due date must be on or after its start date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}/tasks/${task._id}`, {
        method: "PATCH",
        body: {
          title: draft.title.trim() || task.title,
          description: draft.description,
          columnId: draft.columnId,
          priority: draft.priority,
          startDate: draft.startDate ? new Date(draft.startDate).toISOString() : null,
          dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : null,
          progress: Number(draft.progress),
          sprintId: draft.sprintId || null,
          dependencies: draft.dependencies,
          assignees: draft.assignees,
          labels: draft.labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 8),
          checklist: draft.checklist,
        },
      });
      setDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function postComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${task._id}/comments`, { method: "POST", body: { body: comment.trim() } });
      setComment("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteComment(id) {
    try {
      await api(`/api/projects/${projectId}/tasks/${task._id}/comments/${id}`, { method: "DELETE" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    try {
      await api(`/api/projects/${projectId}/tasks/${task._id}`, { method: "DELETE" });
      onDeleted?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const doneCount = draft.checklist.filter((c) => c.done).length;

  return (
    <div className="drawer-wrap" role="dialog" aria-modal="true" aria-label="Task details">
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="drawer">
        <div className="drawer-head">
          <input
            className="drawer-title"
            value={draft.title}
            onChange={(e) => change({ title: e.target.value })}
            aria-label="Task title"
            maxLength={160}
          />
          <button className="btn secondary icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="drawer-grid">
          <label className="field">
            <span>Status</span>
            <select value={draft.columnId} onChange={(e) => change({ columnId: e.target.value })}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={draft.priority} onChange={(e) => change({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Start date</span>
            <input type="date" value={draft.startDate} onChange={(e) => change({ startDate: e.target.value })} disabled={!canEdit} />
          </label>
          <label className="field">
            <span>Due date</span>
            <input type="date" value={draft.dueDate} onChange={(e) => change({ dueDate: e.target.value })} disabled={!canEdit} />
          </label>
          <label className="field">
            <span>Progress ({draft.progress}%)</span>
            <input type="range" min="0" max="100" step="5" value={draft.progress} onChange={(e) => change({ progress: Number(e.target.value) })} disabled={!canEdit} />
          </label>
          <label className="field">
            <span>Sprint</span>
            <select value={draft.sprintId} onChange={(e) => change({ sprintId: e.target.value })} disabled={!canEdit}>
              <option value="">No sprint</option>
              {sprints
                .filter((sprint) => sprint.status !== "completed" || sprint._id === draft.sprintId)
                .map((sprint) => <option key={sprint._id} value={sprint._id}>{sprint.name} ({sprint.status})</option>)}
            </select>
          </label>
          <label className="field task-dependencies">
            <span>Depends on</span>
            <select
              multiple
              value={draft.dependencies}
              onChange={(e) => change({ dependencies: Array.from(e.target.selectedOptions, (option) => option.value) })}
              disabled={!canEdit}
            >
              {tasks.filter((item) => item._id !== task._id).map((item) => (
                <option key={item._id} value={item._id}>{item.title}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Labels (comma separated)</span>
            <input value={draft.labels} onChange={(e) => change({ labels: e.target.value })} placeholder="design, api" />
          </label>
        </div>

        <div className="field">
          <span>Assigned to</span>
          <div className="chips">
            {members.map((m) => {
              const on = draft.assignees.includes(m._id);
              return (
                <button
                  type="button"
                  key={m._id}
                  className={`pick ${on ? "on" : ""}`}
                  onClick={() => toggleAssignee(m._id)}
                  aria-pressed={on}
                >
                  <Avatar user={m} size={20} /> {m.name}
                </button>
              );
            })}
          </div>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea rows={4} value={draft.description} onChange={(e) => change({ description: e.target.value })} />
        </label>

        <div className="field">
          <span>
            Checklist {draft.checklist.length > 0 && `(${doneCount}/${draft.checklist.length})`}
          </span>
          <ul className="checklist">
            {draft.checklist.map((item, i) => (
              <li key={item._id || `new-${i}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      change({ checklist: draft.checklist.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c)) })
                    }
                  />
                  <span className={item.done ? "struck" : ""}>{item.text}</span>
                </label>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => change({ checklist: draft.checklist.filter((_, idx) => idx !== i) })}
                  aria-label={`Remove ${item.text}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {canEdit && (
            <form className="stack nowrap" onSubmit={addItem}>
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a sub-step" maxLength={200} />
              <button className="btn secondary">Add</button>
            </form>
          )}
        </div>

        {canEdit && (
          <div className="drawer-actions">
            <button className="btn" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
            {canDelete && (
              <button className="btn danger" type="button" onClick={remove}>
                Delete task
              </button>
            )}
          </div>
        )}

        <h4 className="drawer-section">Comments ({task.comments?.length || 0})</h4>
        <ul className="comments">
          {(task.comments || []).map((c) => (
            <li key={c._id}>
              <Avatar user={c.author} size={26} />
              <div>
                <div>
                  <strong>{c.author?.name}</strong> <span className="muted">{formatDateTime(c.createdAt)}</span>
                </div>
                <div className="comment-body">{c.body}</div>
                {(c.author?._id === me?._id || c.author?._id === me?.id || canDelete) && (
                  <button className="link-btn" type="button" onClick={() => deleteComment(c._id)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="stack nowrap" onSubmit={postComment}>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={2000} />
            <button className="btn">Post</button>
          </form>
        )}
      </div>
    </div>
  );
}
