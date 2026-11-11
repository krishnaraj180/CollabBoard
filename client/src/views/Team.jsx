"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { ActivityFeed, Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { roleLabel } from "../lib/format";

const workspaceRoles = [
  ["admin", "Workspace admin"],
  ["ceo", "CEO"],
  ["managing_director", "Managing Director (MD)"],
  ["cto", "CTO"],
  ["project_manager", "Project Manager"],
  ["engineering_manager", "Engineering Manager"],
  ["development_team_lead", "Development Team Lead"],
  ["react_developer", "React Developer"],
  ["nodejs_developer", "Node.js Developer"],
  ["java_developer", "Java Developer"],
  ["python_developer", "Python Developer"],
  ["qa_team_lead", "QA Team Lead"],
  ["qa_engineer", "QA Engineer"],
  ["design_team_lead", "Design Team Lead"],
  ["ui_ux_designer", "UI/UX Designer"],
  ["devops_team_lead", "DevOps Team Lead"],
  ["devops_engineer", "DevOps Engineer"],
  ["finance_manager", "Finance Manager"],
  ["accountant", "Accountant"],
  ["finance_executive", "Finance Executive"],
  ["marketing_team_lead", "Marketing Team Lead"],
  ["marketing_executive", "Marketing Executive"],
  ["hr_manager", "HR Manager"],
  ["hr_executive", "HR Executive"],
  ["hr_employee", "HR Employee"],
  ["marketing", "Marketing"],
  ["finance", "Finance"],
  ["frontend_developer", "Frontend Developer (legacy)"],
  ["backend_developer", "Backend Developer (legacy)"],
  ["member", "Member"],
];
const hiddenDepartmentNames = new Set([
  "Development Department",
  "QA Department",
  "Design Department",
  "Finance Department",
  "Marketing Department",
  "HR Department",
  "AI",
  "AI Department",
  "DevOps",
  "DevOps Department",
  "Sales",
  "Sales Department",
]);
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
  const [newDepartment, setNewDepartment] = useState("");
  const [positionDrafts, setPositionDrafts] = useState({});

  const myId = user?._id || user?.id;
  const me = workspace?.members?.find((m) => m.user?._id === myId);
  const workspaceMembers = workspace?.members?.filter((m) => m.user) || [];
  const departmentOptions = (workspace?.organization?.departments || []).filter((department) => !hiddenDepartmentNames.has(department.name));
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

  const saveOrganizationMember = (member, changes) => {
    const department = changes.department ?? member.department ?? "";
    const title = changes.title ?? member.title ?? "";
    const reportsTo = changes.reportsTo !== undefined ? changes.reportsTo : member.reportsTo || null;
    run(
      () => api(`/api/workspaces/${workspaceId}/members/${member.user._id}/organization`, {
        method: "PATCH",
        body: { department, title, reportsTo },
      }),
      "Organization assignment updated"
    );
  };

  const saveDepartments = (departments) =>
    {
      const availablePositions = new Map(departments.map((department) => [department.name, new Set(department.positions)]));
      const affectedMembers = workspace.members.filter((member) =>
        member.department && !availablePositions.get(member.department)?.has(member.title)
      ).length;
      if (affectedMembers > 0 && !window.confirm(
        `This change will clear department and position assignments for ${affectedMembers} teammate${affectedMembers === 1 ? "" : "s"}. Continue?`
      )) return;
      run(
        () => api(`/api/workspaces/${workspaceId}/organization`, { method: "PATCH", body: { departments } }),
        "Organization structure updated"
      );
    };

  const addDepartment = (e) => {
    e.preventDefault();
    const name = newDepartment.trim();
    if (!name) return;
    if (workspace.organization.departments.some((department) => department.name.toLowerCase() === name.toLowerCase())) {
      setError("A department with that name already exists.");
      return;
    }
    saveDepartments([...workspace.organization.departments, { name, positions: [] }]);
    setNewDepartment("");
  };

  const addPosition = (departmentName) => {
    const position = (positionDrafts[departmentName] || "").trim();
    if (!position) return;
    const department = workspace.organization.departments.find((item) => item.name === departmentName);
    if (department.positions.some((existing) => existing.toLowerCase() === position.toLowerCase())) {
      setError("That position already exists in this department.");
      return;
    }
    const departments = workspace.organization.departments.map((department) => {
      if (department.name !== departmentName) return department;
      return { ...department, positions: [...department.positions, position] };
    });
    saveDepartments(departments);
    setPositionDrafts({ ...positionDrafts, [departmentName]: "" });
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
              <p className="muted">{workspaceMembers.length} people in {workspace.name}. Your role: <strong>{role}</strong>.</p>
            </div>
          </div>

          <div className="split">
            <section>
              <div className="table-wrap">
                <table className="members">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Access</th>
                      <th>Department</th>
                      <th>Position</th>
                      <th>Reports to</th>
                      <th className="hide-sm">Joined</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceMembers.map((m) => {
                      const online = onlineUserIds.includes(String(m.user._id));
                      const self = m.user._id === myId;
                      const canRemove =
                        m.role !== "owner" && isManager && !(role === "admin" && m.role === "admin");
                      return (
                        <tr key={m.user._id}>
                          <td data-label="Person">
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
                          <td data-label="Access">
                            {isOwner && m.role !== "owner" ? (
                              <select value={m.role} onChange={(e) => changeRole(m.user._id, e.target.value)} aria-label={`Access role for ${m.user.name}`}>
                                {workspaceRoles.map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className={`role-pill ${m.role}`}>{roleLabel(m.role)}</span>
                            )}
                          </td>
                          <td data-label="Department">
                            {isManager ? (
                              <select
                                aria-label={`Department for ${m.user.name}`}
                                value={m.department || ""}
                                onChange={(e) => {
                                  const department = e.target.value;
                                  const positions = workspace.organization.departments.find((item) => item.name === department)?.positions || [];
                                  saveOrganizationMember(m, { department, title: positions[0] || "" });
                                }}
                              >
                                <option value="">Unassigned</option>
                                {departmentOptions.map((department) => (
                                  <option key={department.name} value={department.name}>{department.name}</option>
                                ))}
                              </select>
                            ) : <span>{m.department || "—"}</span>}
                          </td>
                          <td data-label="Position">
                            {isManager ? (
                              <select
                                aria-label={`Position for ${m.user.name}`}
                                value={m.title || ""}
                                disabled={!m.department}
                                onChange={(e) => saveOrganizationMember(m, { title: e.target.value })}
                              >
                                <option value="">Unassigned</option>
                                {(departmentOptions.find((item) => item.name === m.department)?.positions || []).map((title) => (
                                  <option key={title} value={title}>{title}</option>
                                ))}
                              </select>
                            ) : <span>{m.title || "—"}</span>}
                          </td>
                          <td data-label="Reports to">
                            {isManager ? (
                              <select
                                aria-label={`Manager for ${m.user.name}`}
                                value={m.reportsTo?._id || m.reportsTo || ""}
                                onChange={(e) => saveOrganizationMember(m, { reportsTo: e.target.value || null })}
                              >
                                <option value="">No manager</option>
                                {workspaceMembers.filter((candidate) => candidate.user._id !== m.user._id).map((candidate) => (
                                  <option key={candidate.user._id} value={candidate.user._id}>{candidate.user.name}</option>
                                ))}
                              </select>
                            ) : <span>{workspaceMembers.find((candidate) => candidate.user._id === String(m.reportsTo?._id || m.reportsTo))?.user.name || "—"}</span>}
                          </td>
                          <td data-label="Joined" className="hide-sm muted">{new Date(m.joinedAt).toLocaleDateString()}</td>
                          <td data-label="Actions">
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
                <strong>Project workflow</strong> routes business approval to the MD, technical review to the CTO, planning and delivery to the Project Manager, then through design, engineering, QA, DevOps, Marketing, Finance, and final CEO/MD review.
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
                        {workspaceRoles.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <button className="btn">Add to workspace</button>
                    </form>
                  </section>
                  <section className="box">
                    <h3>Organization setup</h3>
                    <p className="muted">Manage the departments and positions available for team assignments.</p>
                    <form className="col-form" onSubmit={addDepartment}>
                      <input
                        value={newDepartment}
                        onChange={(e) => setNewDepartment(e.target.value)}
                        placeholder="New department"
                        maxLength={60}
                        aria-label="New department"
                      />
                      <button className="btn secondary" disabled={!newDepartment.trim()}>Add department</button>
                    </form>
                    <div className="org-settings">
                      {departmentOptions.map((department) => (
                        <div className="org-department" key={department.name}>
                          <div className="org-department-head">
                            <strong>{department.name}</strong>
                            <button
                              className="btn secondary"
                              disabled={workspace.organization.departments.length <= 1}
                              onClick={() => saveDepartments(workspace.organization.departments.filter((item) => item.name !== department.name))}
                            >
                              Remove
                            </button>
                          </div>
                          <ul>
                            {department.positions.map((position) => (
                              <li key={position}>
                                {position}
                                <button
                                  className="org-remove-position"
                                  aria-label={`Remove ${position} from ${department.name}`}
                                  onClick={() => saveDepartments(workspace.organization.departments.map((item) =>
                                    item.name === department.name
                                      ? { ...item, positions: item.positions.filter((title) => title !== position) }
                                      : item
                                  ))}
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                          <div className="org-add-position">
                            <input
                              value={positionDrafts[department.name] || ""}
                              onChange={(e) => setPositionDrafts({ ...positionDrafts, [department.name]: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addPosition(department.name);
                                }
                              }}
                              placeholder="New position"
                              maxLength={60}
                              aria-label={`New position in ${department.name}`}
                            />
                            <button className="btn secondary" onClick={() => addPosition(department.name)} disabled={!(positionDrafts[department.name] || "").trim()}>
                              Add
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
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
                  <p className="muted">Workspace owners and admins manage invitations. Project actions and approvals are limited to the assigned organizational roles.</p>
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
