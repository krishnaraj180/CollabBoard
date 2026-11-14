"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { arrayMove } from "@dnd-kit/sortable";
import { api } from "../api";
import AppShell from "../components/AppShell";
import MilestonePanel from "../components/MilestonePanel";
import ProjectKanban from "../components/ProjectKanban";
import ProjectTimeline from "../components/ProjectTimeline";
import SprintPanel from "../components/SprintPanel";
import TaskDrawer from "../components/TaskDrawer";
import { ActivityFeed, ProgressBar, StatCard, StatusBadge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import { PRIORITIES, PROJECT_STATUS, formatDate, isDoneColumn, toInputDate } from "../lib/format";

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
  const [sprints, setSprints] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [members, setMembers] = useState([]);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [projectManagers, setProjectManagers] = useState([]);
  const [myRole, setMyRole] = useState("member");
  const [canManageProject, setCanManageProject] = useState(false);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [planningLoading, setPlanningLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({ q: "", assignee: "", priority: "", hideDone: false });
  const [tab, setTab] = useState("board");
  const [scopeDraft, setScopeDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");
  const [milestonesDraft, setMilestonesDraft] = useState("");
  const [teamAssignmentsDraft, setTeamAssignmentsDraft] = useState([]);
  const [teamMemberDepartment, setTeamMemberDepartment] = useState("");
  const [teamMemberIds, setTeamMemberIds] = useState([]);
  const [addingTeamMembers, setAddingTeamMembers] = useState(false);
  const [teamMemberNotice, setTeamMemberNotice] = useState("");
  const [workflowNote, setWorkflowNote] = useState("");

  const myId = user?._id || user?.id;
  const isManager = myRole === "owner" || myRole === "admin" || myRole === "ceo" || myRole === "managing_director";
  const canEditProjectTasks = Boolean(project && taskStageRoles[project.workflowStage] && (
    ["owner", "admin", "ceo", "managing_director", "project_manager"].includes(myRole) ||
    (taskStageRoles[project.workflowStage].includes(myRole) &&
      project.departmentAssignments?.some((assignment) =>
        taskStageDepartments[project.workflowStage]?.includes(assignment.department) &&
        (String(assignment.teamLead?._id || assignment.teamLead) === String(myId) ||
          assignment.members?.some((member) => String(member?._id || member) === String(myId)))
      ))
  ));
  const canEdit = canEditProjectTasks;
  const canEditPlanning = project?.workflowStage === "project_setup" && ["owner", "ceo", "managing_director", "project_manager"].includes(myRole);
  const canAssignTeams = project?.workflowStage === "team_assignment" && ["owner", "ceo", "managing_director", "project_manager"].includes(myRole);

  async function load() {
    setLoading(true);
    setPlanningLoading(true);
    setError("");
    try {
      const [board, ws, act, sprintData, milestoneData] = await Promise.all([
        api(`/api/projects/${projectId}`),
        api(`/api/workspaces/${workspaceId}`),
        api(`/api/projects/${projectId}/activity`),
        api(`/api/projects/${projectId}/sprints`),
        api(`/api/projects/${projectId}/milestones`),
      ]);
      setProject(board.project);
      setTasks(board.tasks);
      setSprints(sprintData.sprints);
      setMilestones(milestoneData.milestones);
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
      setPlanningLoading(false);
    }
  }

  async function refreshSprints() {
    try {
      const data = await api(`/api/projects/${projectId}/sprints`);
      setSprints(data.sprints);
      return data.sprints;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function refreshMilestones() {
    try {
      const data = await api(`/api/projects/${projectId}/milestones`);
      setMilestones(data.milestones);
      return data.milestones;
    } catch (err) {
      setError(err.message);
      throw err;
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
    function onSprint({ projectId: id }) {
      if (id === projectId) {
        api(`/api/projects/${projectId}/sprints`).then((data) => setSprints(data.sprints)).catch((err) => setError(err.message));
      }
    }
    function onMilestone({ projectId: id }) {
      if (id === projectId) {
        api(`/api/projects/${projectId}/milestones`).then((data) => setMilestones(data.milestones)).catch((err) => setError(err.message));
      }
    }
    socket.on("task:updated", onTask);
    socket.on("project:updated", onProject);
    socket.on("project:deleted", onDeleted);
    socket.on("activity:new", onActivity);
    socket.on("sprint:updated", onSprint);
    socket.on("milestone:updated", onMilestone);
    return () => {
      socket.off("task:updated", onTask);
      socket.off("project:updated", onProject);
      socket.off("project:deleted", onDeleted);
      socket.off("activity:new", onActivity);
      socket.off("sprint:updated", onSprint);
      socket.off("milestone:updated", onMilestone);
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
    const order = tasks
      .filter((item) => item.columnId === columnId)
      .reduce((max, item) => Math.max(max, item.order), -1) + 1;
    setTasks((list) => list.map((t) => (t._id === taskId ? { ...t, columnId, order } : t)));
    try {
      await api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: { columnId, order } });
    } catch (err) {
      setTasks((list) => list.map((t) => (t._id === taskId ? task : t)));
      setError(err.message);
    }
  }

  async function dropTask({ taskId, targetColumnId, targetTaskId, filtering: hasFilters }) {
    const task = tasks.find((item) => String(item._id) === String(taskId));
    if (!task || !targetColumnId) return;
    if (hasFilters && task.columnId === targetColumnId) return;

    const sortedInColumn = (columnId) =>
      tasks.filter((item) => item.columnId === columnId).sort((a, b) => a.order - b.order);
    let updatedTasks;
    if (task.columnId === targetColumnId) {
      const current = sortedInColumn(task.columnId);
      const from = current.findIndex((item) => String(item._id) === String(taskId));
      const to = targetTaskId
        ? current.findIndex((item) => String(item._id) === String(targetTaskId))
        : current.length - 1;
      if (from < 0 || to < 0 || from === to) return;
      updatedTasks = arrayMove(current, from, to).map((item, order) => ({ ...item, order }));
    } else {
      const source = sortedInColumn(task.columnId).filter((item) => String(item._id) !== String(taskId));
      const destination = sortedInColumn(targetColumnId);
      const insertionIndex = !hasFilters && targetTaskId
        ? Math.max(0, destination.findIndex((item) => String(item._id) === String(targetTaskId)))
        : destination.length;
      destination.splice(insertionIndex, 0, { ...task, columnId: targetColumnId });
      updatedTasks = [
        ...source.map((item, order) => ({ ...item, order })),
        ...destination.map((item, order) => ({ ...item, columnId: targetColumnId, order })),
      ];
    }

    const snapshot = tasks;
    const updatesById = new Map(updatedTasks.map((item) => [String(item._id), item]));
    setTasks((list) => list.map((item) => updatesById.get(String(item._id)) || item));
    try {
      const data = await api(`/api/projects/${projectId}/tasks/reorder`, {
        method: "PATCH",
        body: {
          moves: updatedTasks.map((item) => ({
            taskId: item._id,
            columnId: item.columnId,
            order: item.order,
          })),
        },
      });
      const savedById = new Map(data.tasks.map((item) => [String(item._id), item]));
      setTasks((list) => list.map((item) => savedById.get(String(item._id)) || item));
    } catch (err) {
      setTasks(snapshot);
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

  async function addProjectTeamMembers() {
    setAddingTeamMembers(true);
    setError("");
    setTeamMemberNotice("");
    try {
      const data = await api(`/api/projects/${projectId}/team-members`, {
        method: "POST",
        body: { department: teamMemberDepartment, memberIds: teamMemberIds },
      });
      setProject(data.project);
      setTeamMemberIds([]);
      setTeamMemberNotice(
        data.addedMemberIds.length
          ? `Added ${data.addedMemberIds.length} member${data.addedMemberIds.length === 1 ? "" : "s"} to ${teamMemberDepartment}.`
          : "The selected members are already assigned to this department."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingTeamMembers(false);
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
  const canAddProjectTeamMembers = canManageProject &&
    ["design", "development", "bug_fixing"].includes(project?.workflowStage);
  const selectedTeamAssignment = project?.departmentAssignments?.find(
    (assignment) => assignment.department === teamMemberDepartment
  );
  const alreadyAssignedMemberIds = new Set([
    ...(selectedTeamAssignment?.members || []).map((member) => String(member?._id || member)),
    ...(selectedTeamAssignment?.teamLead ? [String(selectedTeamAssignment.teamLead?._id || selectedTeamAssignment.teamLead)] : []),
  ]);
  const eligibleTeamMembers = workspaceMembers.filter((member) =>
    member.department === teamMemberDepartment &&
    (departmentMemberRoles[teamMemberDepartment] || []).includes(member.role) &&
    member.user &&
    !alreadyAssignedMemberIds.has(String(member.user._id))
  );

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
                            const membership = workspaceMembers.find((member) => member.user?._id === lead._id);
                            return membership?.department === assignment.department &&
                              (departmentLeadRoles[assignment.department] || []).includes(membership.role);
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
                          .filter((member) => member.department === assignment.department &&
                            (departmentMemberRoles[assignment.department] || []).includes(member.role))
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

            {canAddProjectTeamMembers && (
              <div className="admin-box workflow-form">
                <h3>Add members to this project</h3>
                <p className="muted">Add workspace members to an assigned department without changing the current workflow stage.</p>
                <label className="field">
                  <span>Project department</span>
                  <select
                    value={teamMemberDepartment}
                    onChange={(e) => {
                      setTeamMemberDepartment(e.target.value);
                      setTeamMemberIds([]);
                      setTeamMemberNotice("");
                    }}
                  >
                    <option value="">Select department</option>
                    {(project.departmentAssignments || []).map((assignment) => (
                      <option key={assignment.department} value={assignment.department}>{assignment.department}</option>
                    ))}
                  </select>
                </label>
                {selectedTeamAssignment && (
                  <p className="muted">
                    Current team: {[selectedTeamAssignment.teamLead, ...(selectedTeamAssignment.members || [])]
                      .filter(Boolean)
                      .map((member) => member.name || "Workspace member")
                      .join(", ")}
                  </p>
                )}
                {teamMemberDepartment && (
                  <label className="field">
                    <span>Eligible workspace members</span>
                    <select
                      multiple
                      value={teamMemberIds}
                      onChange={(e) => setTeamMemberIds(Array.from(e.target.selectedOptions, (option) => option.value))}
                    >
                      {eligibleTeamMembers.map((member) => (
                        <option key={member.user._id} value={member.user._id}>{member.user.name}</option>
                      ))}
                    </select>
                    {eligibleTeamMembers.length === 0 && <span className="muted">No unassigned members match this department and role.</span>}
                  </label>
                )}
                {teamMemberNotice && <p className="notice" role="status">{teamMemberNotice}</p>}
                <button
                  className="btn secondary"
                  disabled={addingTeamMembers || !teamMemberDepartment || teamMemberIds.length === 0}
                  onClick={addProjectTeamMembers}
                >
                  {addingTeamMembers ? "Adding members…" : "Add to project"}
                </button>
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
            <button role="tab" aria-selected={tab === "timeline"} className={tab === "timeline" ? "on" : ""} onClick={() => setTab("timeline")}>
              Timeline
            </button>
            <button role="tab" aria-selected={tab === "sprints"} className={tab === "sprints" ? "on" : ""} onClick={() => setTab("sprints")}>
              Sprints
            </button>
            <button role="tab" aria-selected={tab === "milestones"} className={tab === "milestones" ? "on" : ""} onClick={() => setTab("milestones")}>
              Milestones
            </button>
            <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>
              Activity
            </button>
          </div>

          {tab === "activity" && <ActivityFeed items={activity} />}
          {tab === "timeline" && <ProjectTimeline project={project} tasks={tasks} milestones={milestones} />}
          {tab === "sprints" && (
            <SprintPanel
              projectId={projectId}
              sprints={sprints}
              loading={planningLoading}
              canManage={canManageProject}
              onRefresh={refreshSprints}
            />
          )}
          {tab === "milestones" && (
            <MilestonePanel
              projectId={projectId}
              milestones={milestones}
              loading={planningLoading}
              canManage={canManageProject}
              onRefresh={refreshMilestones}
            />
          )}

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

              <ProjectKanban
                project={project}
                tasks={visible}
                filtering={filtering}
                canEdit={canEdit}
                onOpen={setOpenId}
                onMove={moveTask}
                onDrop={dropTask}
              />
            </>
          )}

          {openTask && (
            <TaskDrawer
              projectId={projectId}
              task={openTask}
              columns={project.columns}
              members={members}
              tasks={tasks}
              sprints={sprints}
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
