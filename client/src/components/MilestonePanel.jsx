"use client";

import { useState } from "react";
import { api } from "../api";
import { ProgressBar } from "./ui";
import { formatDate, toInputDate } from "../lib/format";

const blankMilestone = () => ({ title: "", description: "", dueDate: "", progress: 0 });

export default function MilestonePanel({ projectId, milestones, loading, canManage, onRefresh }) {
  const [form, setForm] = useState(blankMilestone);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function reset() {
    setForm(blankMilestone());
    setEditingId("");
  }

  function edit(milestone) {
    setForm({
      title: milestone.title,
      description: milestone.description || "",
      dueDate: toInputDate(milestone.dueDate),
      progress: milestone.progress || 0,
    });
    setEditingId(milestone._id);
    setError("");
    setNotice("");
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        ...(editingId ? { progress: Number(form.progress) } : {}),
      };
      if (editingId) {
        await api(`/api/projects/${projectId}/milestones/${editingId}`, { method: "PATCH", body });
        setNotice("Milestone updated.");
      } else {
        await api(`/api/projects/${projectId}/milestones`, { method: "POST", body });
        setNotice("Milestone created.");
      }
      reset();
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateMilestone(milestone, action) {
    setBusyId(milestone._id);
    setError("");
    setNotice("");
    try {
      if (action === "complete") {
        await api(`/api/projects/${projectId}/milestones/${milestone._id}/complete`, { method: "POST", body: {} });
        setNotice(`${milestone.title} completed.`);
      } else {
        if (!window.confirm(`Delete “${milestone.title}”?`)) return;
        await api(`/api/projects/${projectId}/milestones/${milestone._id}`, { method: "DELETE" });
        setNotice("Milestone deleted.");
      }
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="planning-panel">
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {canManage && (
        <form className="box planning-form" onSubmit={save}>
          <div className="planning-form-heading">
            <div>
              <h3>{editingId ? "Edit milestone" : "Add milestone"}</h3>
              <p className="muted">Track a dated project outcome and its completion progress.</p>
            </div>
            {editingId && <button className="btn secondary" type="button" onClick={reset}>Cancel edit</button>}
          </div>
          <div className="planning-fields">
            <label className="field">
              <span>Name</span>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} minLength={2} maxLength={120} required />
            </label>
            <label className="field">
              <span>Deadline</span>
              <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
            </label>
            <label className="field planning-description">
              <span>Description</span>
              <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1000} />
            </label>
            {editingId && (
              <label className="field">
                <span>Progress ({form.progress}%)</span>
                <input type="range" min="0" max="100" step="5" value={form.progress} onChange={(event) => setForm({ ...form, progress: Number(event.target.value) })} />
              </label>
            )}
          </div>
          <button className="btn" disabled={saving}>{saving ? "Saving…" : editingId ? "Save milestone" : "Add milestone"}</button>
        </form>
      )}

      {loading && <div className="skeleton" aria-label="Loading milestones" />}
      {!loading && milestones.length === 0 && <div className="empty">No project milestones yet.</div>}
      <div className="milestone-list">
        {!loading && milestones.map((milestone) => (
          <article className={`box milestone-card ${milestone.completedAt ? "completed" : ""}`} key={milestone._id}>
            <div className="milestone-heading">
              <div className="grow">
                <div className="sprint-title-row">
                  <h3>{milestone.title}</h3>
                  {milestone.completedAt && <span className="sprint-status completed">Completed</span>}
                </div>
                <p className="muted">{milestone.description || "No description."}</p>
              </div>
              <span className={`due ${milestone.dueDate && new Date(milestone.dueDate) < new Date() && !milestone.completedAt ? "overdue" : ""}`}>
                {milestone.dueDate ? `Due ${formatDate(milestone.dueDate)}` : "No deadline"}
              </span>
            </div>
            <ProgressBar percent={milestone.progress || 0} label={`${milestone.title} progress`} />
            {canManage && (
              <div className="sprint-actions">
                <button className="btn secondary" type="button" onClick={() => edit(milestone)} disabled={saving || Boolean(busyId)}>Edit</button>
                {!milestone.completedAt && (
                  <button className="btn" type="button" onClick={() => updateMilestone(milestone, "complete")} disabled={busyId === milestone._id}>
                    {busyId === milestone._id ? "Completing…" : "Mark complete"}
                  </button>
                )}
                <button className="btn danger" type="button" onClick={() => updateMilestone(milestone, "delete")} disabled={busyId === milestone._id}>Delete</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
