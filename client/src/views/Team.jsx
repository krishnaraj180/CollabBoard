"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { ActivityFeed, Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";

export default function Team() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const { onlineUserIds, socket } = useRealtime();
  const [workspace, setWorkspace] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [settings, setSettings] = useState({ name: "", description: "" });

  const myId = user?._id || user?.id;
  const me = workspace?.members?.find((m) => m.user?._id === myId);
  const role = me?.role;
  const isOwner = role === "owner";
  const isManager = role === "owner" || role === "admin";

  async function load() {
    try {
      const [ws, act] = await Promise.all([
        api(`/api/workspaces/${workspaceId}`),
        api(`/api/workspaces/${workspaceId}/activity`),
      ]);
      setWorkspace(ws.workspace);
      setSettings({ name: ws.workspace.name, description: ws.workspace.description || "" });
      setActivity(act.activity);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!socket) return undefined;
    const onActivity = (a) => {
      if (a.workspace === workspaceId) setActivity((list) => [a, ...list].slice(0, 50));
    };
    socket.on("activity:new", onActivity);
    return () => socket.off("activity:new", onActivity);
  }, [socket, workspaceId]);

  function flash(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 3000);
  }

  async function run(fn, success) {
    setError("");
    try {
      const data = await fn();
      if (data?.workspace) setWorkspace(data.workspace);
      if (success) flash(success);
    } catch (err) {
      setError(err.message);
    }
  }

  const sendInvite = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await api(`/api/workspaces/${workspaceId}/invites`, { method: "POST", body: invite });
      setInvite({ email: "", role: "member" });
      return data;
    }, "Teammate added");
  };

  const changeRole = (userId, next) =>
    run(() => api(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: { role: next } }), "Role updated");

  const removeMember = (m) => {
    if (!window.confirm(`Remove ${m.user.name} from this workspace?`)) return;
    run(
      () => api(`/api/workspaces/${workspaceId}/members/${m.user._id}`, { method: "DELETE" }),
      "Member removed"
    );
  };

  const saveSettings = (e) => {
    e.preventDefault();
    run(() => api(`/api/workspaces/${workspaceId}`, { method: "PATCH", body: settings }), "Workspace updated");
  };

  return (
    <AppShell workspaceId={workspaceId}>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {workspace && (
        <>
          <div className="page-head">
            <div className="grow">
              <h1>Team & roles</h1>
              <p className="muted">{workspace.members.length} people in {workspace.name}. Your role: <strong>{role}</strong>.</p>
            </div>
          </div>

          <div className="split">
            <section>
              <div className="table-wrap">
                <table className="members">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Role</th>
                      <th className="hide-sm">Joined</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.members.map((m) => {
                      const online = onlineUserIds.includes(String(m.user._id));
                      const self = m.user._id === myId;
                      const canRemove =
                        m.role !== "owner" && isManager && !(role === "admin" && m.role === "admin");
                      return (
                        <tr key={m.user._id}>
                          <td>
                            <div className="who">
                              <Avatar user={m.user} size={32} />
                              <div>
                                <strong>{m.user.name}</strong> {self && <span className="muted">(you)</span>}
                                <div className="muted">
                                  <span className={`dot ${online ? "on" : ""}`} /> {online ? "Online" : "Offline"} · {m.user.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {isOwner && m.role !== "owner" ? (
                              <select value={m.role} onChange={(e) => changeRole(m.user._id, e.target.value)} aria-label={`Role for ${m.user.name}`}>
                                <option value="member">member</option>
                                <option value="admin">admin</option>
                                <option value="viewer">viewer</option>
                              </select>
                            ) : (
                              <span className={`role-pill ${m.role}`}>{m.role}</span>
                            )}
                          </td>
                          <td className="hide-sm muted">{new Date(m.joinedAt).toLocaleDateString()}</td>
                          <td>
                            {canRemove && (
                              <button className="btn secondary" onClick={() => removeMember(m)}>
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="role-help muted">
                <strong>Owner</strong> manages everything including roles · <strong>Admin</strong> manages projects, status and members ·{" "}
                <strong>Member</strong> works on tasks and chats · <strong>Viewer</strong> has read-only access.
              </div>
            </section>

            <aside className="side-col">
              {isManager ? (
                <>
                  <section className="box">
                    <h3>Invite a teammate</h3>
                    <p className="muted">They need an existing CollabBoard account.</p>
                    <form className="col-form" onSubmit={sendInvite}>
                      <input type="email" required placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                      <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button className="btn">Add to workspace</button>
                    </form>
                  </section>
                  <section className="box">
                    <h3>Workspace settings</h3>
                    <form className="col-form" onSubmit={saveSettings}>
                      <input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} required minLength={2} maxLength={80} aria-label="Workspace name" />
                      <textarea rows={3} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} maxLength={400} aria-label="Description" />
                      <button className="btn secondary">Save</button>
                    </form>
                  </section>
                </>
              ) : (
                <section className="box">
                  <h3>Member access</h3>
                  <p className="muted">Only owners and admins can invite people or change roles. Ask one of them if you need access changed.</p>
                </section>
              )}
              <section className="box">
                <h3>Audit trail</h3>
                <ActivityFeed items={activity} />
              </section>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  );
}
