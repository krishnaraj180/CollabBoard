"use client";

import { useState } from "react";
import { api } from "../api";
import { ProgressBar } from "./ui";
import { formatDate, toInputDate } from "../lib/format";

function blankSprint() {
  return { name: "", goal: "", startDate: "", endDate: "" };
}

export default function SprintPanel({ projectId, sprints, loading, canManage, onRefresh }) {
  const [form, setForm] = useState(blankSprint);
  const [editingId, setEditingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function edit(sprint) {
    setEditingId(sprint._id);
    setForm({
      name: sprint.name,
      goal: sprint.goal || "",
      startDate: toInputDate(sprint.startDate),
      endDate: toInputDate(sprint.endDate),
    });
    setError("");
    setNotice("");
  }

  function reset() {
    setForm(blankSprint());
    setEditingId("");
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!form.startDate || !form.endDate || form.endDate <= form.startDate) {
        throw new Error("Sprint end date must be after its start date.");
      }
      const editedSprint = sprints.find((sprint) => sprint._id === editingId);
      const datesEditable = !editedSprint || editedSprint.status !== "completed";
      const body = {
        name: form.name.trim(),
        goal: form.goal.trim(),
        ...(datesEditable ? {
          startDate: new Date(form.startDate).toISOString(),
          endDate: new Date(form.endDate).toISOString(),
        } : {}),
      };
      if (editingId) {
        await api(`/api/projects/${projectId}/sprints/${editingId}`, { method: "PATCH", body });
        setNotice("Sprint updated.");
      } else {
        await api(`/api/projects/${projectId}/sprints`, { method: "POST", body });
        setNotice("Sprint created.");
      }
      reset();
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function transition(sprint, action) {
    setBusyId(sprint._id);
    setError("");
    setNotice("");
    try {
      await api(`/api/projects/${projectId}/sprints/${sprint._id}/${action}`, { method: "POST", body: {} });
      setNotice(action === "start" ? `${sprint.name} started.` : `${sprint.name} completed.`);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  const activeSprint = sprints.find((sprint) => sprint.status === "active");

  return (
    <section className="planning-panel">
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {canManage && (
        <form className="box planning-form" onSubmit={save}>
          <div className="planning-form-heading">
            <div>
              <h3>{editingId ? "Edit sprint" : "Create sprint"}</h3>
              <p className="muted">Plan a time-boxed set of project tasks.</p>
            </div>
            {editingId && <button className="btn secondary" type="button" onClick={reset}>Cancel edit</button>}
          </div>
          <div className="planning-fields">
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} minLength={2} maxLength={80} required />
            </label>
            <label className="field">
              <span>Sprint goal</span>
              <input value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} maxLength={1000} />
            </label>
            <label className="field">
              <span>Start date</span>
              <input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required disabled={Boolean(editingId && sprints.find((item) => item._id === editingId)?.status === "completed")} />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required disabled={Boolean(editingId && sprints.find((item) => item._id === editingId)?.status === "completed")} />
            </label>
          </div>
          <button className="btn" disabled={saving}>{saving ? "Saving…" : editingId ? "Save sprint" : "Create sprint"}</button>
        </form>
      )}

      {loading && <div className="skeleton" aria-label="Loading sprints" />}
      {!loading && sprints.length === 0 && <div className="empty">No sprints yet.</div>}
      <div className="sprint-list">
        {!loading && sprints.map((sprint) => (
          <article className="box sprint-card" key={sprint._id}>
            <div className="sprint-card-heading">
              <div className="grow">
                <div className="sprint-title-row">
                  <h3>{sprint.name}</h3>
                  <span className={`sprint-status ${sprint.status}`}>{sprint.status}</span>
                </div>
                <p className="muted">{sprint.goal || "No sprint goal set."}</p>
              </div>
              <div className="sprint-dates">
                <span>{formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}</span>
                <strong>{sprint.completedTaskCount}/{sprint.taskCount} done</strong>
              </div>
            </div>
            <ProgressBar percent={sprint.progress} label={`${sprint.name} progress`} />
            {canManage && (
              <div className="sprint-actions">
                {sprint.status !== "completed" && (
                  <button className="btn secondary" type="button" onClick={() => edit(sprint)} disabled={saving || Boolean(busyId)}>
                    Edit
                  </button>
                )}
                {sprint.status === "planned" && (
                  <button className="btn" type="button" onClick={() => transition(sprint, "start")} disabled={Boolean(activeSprint) || busyId === sprint._id}>
                    {busyId === sprint._id ? "Starting…" : "Start sprint"}
                  </button>
                )}
                {sprint.status === "active" && (
                  <button className="btn" type="button" onClick={() => transition(sprint, "complete")} disabled={busyId === sprint._id}>
                    {busyId === sprint._id ? "Completing…" : "Complete sprint"}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
