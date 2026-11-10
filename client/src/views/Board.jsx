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

const workflowStages = [
  ["business_approval", "MD business approval"],
  ["technical_review", "CTO technical review"],
  ["project_setup", "Project scope and planning"],
  ["team_assignment", "Department and team assignment"],
  ["design", "Design"],
  ["development", "Development"],
  ["code_review", "Code review and integration"],
  ["qa_testing", "QA testing"],
  ["bug_fixing", "Bug fixing"],
  ["deployment", "DevOps deployment"],
  ["production_release", "Production release"],
  ["marketing_launch", "Marketing launch"],
  ["finance_review", "Finance review"],
  ["delivery_review", "PM delivery review"],
  ["executive_review", "CEO/MD final review"],
  ["completed", "Project completed"],
];
const workflowActions = {
  business_approval: [{ action: "approve", label: "Approve business case", roles: ["managing_director"] }],
  technical_review: [{ action: "approve", label: "Approve technical review", roles: ["cto"] }],
  project_setup: [{ action: "submit", label: "Submit project plan", roles: ["project_manager"] }],
  team_assignment: [{ action: "submit", label: "Submit team assignments", roles: ["project_manager"] }],
  design: [{ action: "complete", label: "Complete design", roles: ["design_manager", "design_team_lead", "ui_ux_designer"] }],
  development: [{ action: "complete", label: "Complete development", roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] }],
  code_review: [
    { action: "approve", label: "Approve code review", roles: ["engineering_manager", "development_team_lead"] },
    { action: "request_changes", label: "Request changes", roles: ["engineering_manager", "development_team_lead"], needsNote: true },
  ],
  qa_testing: [
    { action: "pass", label: "QA passed", roles: ["qa_manager", "qa_team_lead", "qa_engineer"] },
    { action: "fail", label: "QA failed — create bug task", roles: ["qa_manager", "qa_team_lead", "qa_engineer"], needsNote: true },
  ],
  bug_fixing: [{ action: "complete", label: "Submit fixes for review", roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] }],
  deployment: [{ action: "deploy", label: "Deploy", roles: ["devops_manager", "devops_team_lead", "devops_engineer"] }],
  production_release: [{ action: "release", label: "Confirm production release", roles: ["devops_manager", "devops_team_lead", "devops_engineer"] }],
  marketing_launch: [{ action: "launch", label: "Complete product launch", roles: ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"] }],
  finance_review: [{ action: "complete", label: "Complete finance review", roles: ["finance_manager", "accountant", "finance_executive", "finance"] }],
  delivery_review: [{ action: "complete", label: "Submit final delivery review", roles: ["project_manager"] }],
  executive_review: [{ action: "complete", label: "Approve final delivery", roles: ["ceo", "managing_director"] }],
};
const departmentLeadRoles = {
  "Development Department": ["engineering_manager", "development_team_lead"],
  "Frontend Team": ["development_team_lead", "team_lead"],
  "Backend Team": ["development_team_lead", "team_lead"],
  "QA Department": ["qa_manager", "qa_team_lead"],
  "Design Department": ["design_manager", "design_team_lead"],
  "DevOps Department": ["devops_manager", "devops_team_lead"],
  "Finance Department": ["finance_manager"],
  "Marketing Department": ["marketing_manager", "marketing"],
  "HR Department": ["hr_manager"],
  "Project Management": ["project_manager"],
};
const departmentMemberRoles = {
  "Development Department": ["engineering_manager", "development_team_lead", "team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  "Frontend Team": ["development_team_lead", "team_lead", "frontend_developer", "react_developer", "ui_developer"],
  "Backend Team": ["development_team_lead", "team_lead", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  "QA Department": ["qa_manager", "qa_team_lead", "qa_engineer"],
  "Design Department": ["design_manager", "design_team_lead", "ui_ux_designer"],
  "DevOps Department": ["devops_manager", "devops_team_lead", "devops_engineer"],
  "Finance Department": ["finance_manager", "accountant", "finance_executive", "finance"],
  "Marketing Department": ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"],
  "HR Department": ["hr_manager", "hr_executive", "recruiter", "hr_employee"],
  "Project Management": ["project_manager"],
};
const taskStageRoles = {
  design: ["design_manager", "design_team_lead", "ui_ux_designer"],
  development: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  bug_fixing: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
};
const taskStageDepartments = {
  design: ["Design Department"],
  development: ["Development Department", "Frontend Team", "Backend Team"],
  bug_fixing: ["Development Department", "Frontend Team", "Backend Team"],
};
const workflowStageDepartments = {
  design: ["Design Department"],
  development: ["Development Department", "Frontend Team", "Backend Team"],
  code_review: ["Development Department"],
  qa_testing: ["QA Department"],
  bug_fixing: ["Development Department", "Frontend Team", "Backend Team"],
  deployment: ["DevOps Department"],
  production_release: ["DevOps Department"],
  marketing_launch: ["Marketing Department"],
  finance_review: ["Finance Department"],
};

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
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [projectManagers, setProjectManagers] = useState([]);
  const [myRole, setMyRole] = useState("member");
  const [canManageProject, setCanManageProject] = useState(false);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [openId, setOpenId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [filters, setFilters] = useState({ q: "", assignee: "", priority: "", hideDone: false });
  const [tab, setTab] = useState("board");
  const [scopeDraft, setScopeDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");
  const [milestonesDraft, setMilestonesDraft] = useState("");
  const [teamAssignmentsDraft, setTeamAssignmentsDraft] = useState([]);
  const [workflowNote, setWorkflowNote] = useState("");

  const myId = user?._id || user?.id;
  const isManager = myRole === "owner" || myRole === "admin";
  const canEditProjectTasks = Boolean(project && taskStageRoles[project.workflowStage] && (
    ["owner", "admin", "project_manager"].includes(myRole) ||
    (taskStageRoles[project.workflowStage].includes(myRole) &&
      project.departmentAssignments?.some((assignment) =>
        taskStageDepartments[project.workflowStage]?.includes(assignment.department) &&
        (String(assignment.teamLead?._id || assignment.teamLead) === String(myId) ||
          assignment.members?.some((member) => String(member?._id || member) === String(myId)))
      ))
  ));
  const canEdit = canEditProjectTasks;
  const canEditPlanning = project?.workflowStage === "project_setup" && ["owner", "project_manager"].includes(myRole);
  const canAssignTeams = project?.workflowStage === "team_assignment" && ["owner", "project_manager"].includes(myRole);

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
      setWorkspaceMembers(ws.workspace.members);
      setDepartments(ws.workspace.organization?.departments || []);
      setProjectManagers(ws.workspace.members.filter((member) => member.role === "project_manager").map((member) => member.user).filter(Boolean));
      setCanManageProject(board.canManageProject);
      setActivity(act.activity);
      setScopeDraft(board.project.scope || "");
      setBudgetDraft(board.project.budget ?? "");
      setMilestonesDraft((board.project.milestones || []).join("\n"));
      setTeamAssignmentsDraft((board.project.departmentAssignments || []).map((assignment) => ({
        department: assignment.department,
        teamLeadId: assignment.teamLead?._id || assignment.teamLead || "",
        memberIds: (assignment.members || []).map((member) => member._id || member),
      })));
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

  async function savePlanning() {
    try {
      const data = await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: {
          scope: scopeDraft,
          budget: budgetDraft === "" ? null : Number(budgetDraft),
          milestones: milestonesDraft.split("\n").map((item) => item.trim()).filter(Boolean),
        },
      });
      setProject((current) => ({ ...current, ...data.project }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTeamAssignments() {
    try {
      const data = await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: { departmentAssignments: teamAssignmentsDraft },
      });
      setProject((current) => ({ ...current, ...data.project }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function transitionWorkflow(action) {
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "POST",
        body: { action, note: workflowNote.trim() },
      });
      setWorkflowNote("");
      await load();
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
  const canDeleteTask = (t) => canManageProject || t.createdBy?._id === myId;
  const currentWorkflowStage = project?.status === "completed" ? "completed" : project?.workflowStage;
  const currentWorkflowIndex = workflowStages.findIndex(([id]) => id === currentWorkflowStage);
  const workflowButtons = workflowActions[currentWorkflowStage] || [];
  const canActOnWorkflow = (button) => {
    if (myRole === "owner") return true;
    if (!button.roles.includes(myRole)) return false;
    const departments = workflowStageDepartments[project?.workflowStage];
    if (!departments) return true;
    return project.departmentAssignments?.some((assignment) =>
      departments.includes(assignment.department) &&
      (String(assignment.teamLead?._id || assignment.teamLead) === String(myId) ||
        assignment.members?.some((member) => String(member?._id || member) === String(myId)))
    );
  };
  const teamLeads = workspaceMembers
    .map((member) => member.user)
    .filter(Boolean);

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
            {project.projectManager?.name && (
              <p className="muted">Project manager: <strong>{project.projectManager.name}</strong></p>
            )}
            {canManageProject && (
              <div className="admin-box">
                <div className="muted">Project controls</div>
                <label className="field inline">
                  <span>Status</span>
                  <select value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                    {Object.entries(PROJECT_STATUS).filter(([id]) => id !== "completed" || currentWorkflowStage === "completed").map(([id, m]) => (
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
                {isManager && (
                  <>
                    <label className="field inline">
                      <span>Project manager</span>
                      <select
                        value={project.projectManager?._id || project.projectManager || ""}
                        onChange={(e) => patchProject({ projectManagerId: e.target.value || null })}
                      >
                        <option value="">Unassigned</option>
                        {projectManagers.map((manager) => (
                          <option key={manager._id} value={manager._id}>{manager.name}</option>
                        ))}
                      </select>
                    </label>
                    <button className="btn danger" onClick={deleteProject}>
                      Delete project
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="stats-row">
            <StatCard label="Tasks complete" value={`${stats.percent}%`} tone="accent" />
            <StatCard label="Open tasks" value={stats.open} />
            <StatCard label="Done" value={stats.completed} tone="good" />
            <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue ? "bad" : ""} />
          </div>
          <ProgressBar percent={stats.percent} label="Task completion" />

          <section className="box workflow-panel">
            <div className="page-head">
              <div className="grow">
                <h2>Project workflow</h2>
                <p className="muted">
                  Current step: <strong>{workflowStages.find(([id]) => id === currentWorkflowStage)?.[1] || currentWorkflowStage}</strong>
                </p>
                <p className="muted">
                  Workflow approvals move forward separately from task completion. Finishing all tasks does not automatically approve or advance a workflow step.
                </p>
              </div>
            </div>
            <ol className="workflow-steps">
              {workflowStages.map(([id, label], index) => (
                <li key={id} className={index === currentWorkflowIndex ? "current" : index < currentWorkflowIndex ? "complete" : ""}>
                  <span>{label}</span>
                  {index === currentWorkflowIndex && <strong aria-current="step">Current</strong>}
                </li>
              ))}
            </ol>

            {canEditPlanning && (
              <div className="admin-box workflow-form">
                <h3>Define scope, budget, timeline and milestones</h3>
                <label className="field">
                  <span>Scope</span>
                  <textarea rows={3} maxLength={4000} value={scopeDraft} onChange={(e) => setScopeDraft(e.target.value)} />
                </label>
                <div className="workflow-fields">
                  <label className="field">
                    <span>Budget</span>
                    <input type="number" min="0" step="0.01" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Timeline / due date</span>
                    <input type="date" value={toInputDate(project.dueDate)} onChange={(e) => patchProject({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  </label>
                </div>
                <label className="field">
                  <span>Milestones (one per line)</span>
                  <textarea rows={4} value={milestonesDraft} onChange={(e) => setMilestonesDraft(e.target.value)} />
                </label>
                <button className="btn secondary" onClick={savePlanning}>Save project plan</button>
              </div>
            )}

            {canAssignTeams && (
              <div className="admin-box workflow-form">
                <h3>Assign departments and team leads</h3>
                {teamAssignmentsDraft.map((assignment, index) => (
                  <div className="workflow-assignment" key={`${assignment.department}-${index}`}>
                    <label className="field">
                      <span>Department</span>
                      <select
                        value={assignment.department}
                        onChange={(e) => setTeamAssignmentsDraft((rows) => rows.map((row, i) => i === index ? { ...row, department: e.target.value } : row))}
                      >
                        <option value="">Select department</option>
                        {departments.map((department) => <option key={department.name} value={department.name}>{department.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Team lead</span>
                      <select
                        value={assignment.teamLeadId}
                        onChange={(e) => setTeamAssignmentsDraft((rows) => rows.map((row, i) => i === index ? { ...row, teamLeadId: e.target.value } : row))}
                      >
                        <option value="">Select lead</option>
                        {teamLeads
                          .filter((lead) => {
                            const role = workspaceMembers.find((member) => member.user?._id === lead._id)?.role;
                            return (departmentLeadRoles[assignment.department] || []).includes(role);
                          })
                          .map((lead) => <option key={lead._id} value={lead._id}>{lead.name}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Team members</span>
                      <select
                        multiple
                        value={assignment.memberIds}
                        onChange={(e) => setTeamAssignmentsDraft((rows) => rows.map((row, i) => i === index
                          ? { ...row, memberIds: Array.from(e.target.selectedOptions, (option) => option.value) }
                          : row))}
                      >
                        {workspaceMembers
                          .filter((member) => (departmentMemberRoles[assignment.department] || []).includes(member.role))
                          .map((member) => member.user)
                          .filter(Boolean)
                          .map((member) => <option key={member._id} value={member._id}>{member.name}</option>)}
                      </select>
                    </label>
                    <button className="btn secondary" onClick={() => setTeamAssignmentsDraft((rows) => rows.filter((_, i) => i !== index))}>Remove</button>
                  </div>
                ))}
                <div className="workflow-actions">
                  <button
                    className="btn secondary"
                    onClick={() => setTeamAssignmentsDraft((rows) => [...rows, { department: "", teamLeadId: "", memberIds: [] }])}
                  >
                    Add department
                  </button>
                  <button className="btn secondary" onClick={saveTeamAssignments}>Save assignments</button>
                </div>
              </div>
            )}

            {workflowButtons.filter(canActOnWorkflow).length > 0 && (
              <div className="workflow-form">
                {workflowButtons.some((button) => button.needsNote) && (
                  <label className="field">
                    <span>Review note</span>
                    <textarea rows={3} maxLength={1000} value={workflowNote} onChange={(e) => setWorkflowNote(e.target.value)} />
                  </label>
                )}
                <div className="workflow-actions">
                  {workflowButtons.filter(canActOnWorkflow).map((button) => (
                    <button
                      className={`btn ${["fail", "request_changes"].includes(button.action) ? "secondary" : ""}`}
                      key={button.action}
                      disabled={button.needsNote && !workflowNote.trim()}
                      onClick={() => transitionWorkflow(button.action)}
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(project.workflowHistory || []).length > 0 && (
              <div className="workflow-history">
                <h3>Workflow history</h3>
                {[...project.workflowHistory].reverse().map((entry, index) => (
                  <p key={`${entry._id || entry.createdAt}-${index}`} className="muted">
                    <strong>{workflowStages.find(([id]) => id === entry.stage)?.[1] || entry.stage}</strong>
                    {" · "}{entry.action.replace("_", " ")} by {entry.actor?.name || "workspace member"}
                    {" · "}{new Date(entry.createdAt).toLocaleString()}
                    {entry.note && <span> — {entry.note}</span>}
                  </p>
                ))}
              </div>
            )}
          </section>

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
