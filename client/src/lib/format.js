export const PROJECT_STATUS = {
  planning: { label: "Planning", tone: "blue" },
  active: { label: "In progress", tone: "green" },
  on_hold: { label: "On hold", tone: "amber" },
  completed: { label: "Completed", tone: "done" },
};

export const PRIORITIES = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

const WORKSPACE_ROLE_LABELS = {
  owner: "Workspace owner",
  admin: "Workspace admin",
  ceo: "CEO",
  managing_director: "Managing Director (MD)",
  cto: "CTO",
  project_manager: "Project Manager",
  engineering_manager: "Engineering Manager",
  team_lead: "Team Lead",
  development_team_lead: "Development Team Lead",
  frontend_developer: "Frontend Developer",
  react_developer: "React Developer",
  ui_developer: "UI Developer",
  backend_developer: "Backend Developer",
  nodejs_developer: "Node.js Developer",
  java_developer: "Java Developer",
  python_developer: "Python Developer",
  qa_manager: "QA Manager",
  qa_team_lead: "QA Team Lead",
  qa_engineer: "QA Engineer",
  design_manager: "Design Manager",
  design_team_lead: "Design Team Lead",
  ui_ux_designer: "UI/UX Designer",
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  recruiter: "Recruiter",
  hr_employee: "HR Employee",
  devops_manager: "DevOps Manager",
  devops_team_lead: "DevOps Team Lead",
  devops_engineer: "DevOps Engineer",
  finance_manager: "Finance Manager",
  accountant: "Accountant",
  finance_executive: "Finance Executive",
  marketing_manager: "Marketing Manager",
  marketing_team_lead: "Marketing Team Lead",
  marketing_executive: "Marketing Executive",
  marketing: "Marketing",
  finance: "Finance",
  member: "Member",
  viewer: "Viewer (read only)",
};

export function roleLabel(role) {
  return WORKSPACE_ROLE_LABELS[role] || role;
}

export function initials(name = "?") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function formatDate(value) {
  if (!value) return "";
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return "";
  return dateTimeFmt.format(new Date(value));
}

/** yyyy-mm-dd for <input type="date"> */
export function toInputDate(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function timeAgo(value) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(value);
}

/** "overdue" | "soon" | "" – used to colour due dates. */
export function dueTone(dueDate, done) {
  if (!dueDate || done) return "";
  const diff = new Date(dueDate).getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 3 * 24 * 3600 * 1000) return "soon";
  return "";
}

export function isDoneColumn(project, columnId) {
  if (!project) return false;
  const flagged = project.columns.filter((c) => c.done).map((c) => c.id);
  if (flagged.length) return flagged.includes(columnId);
  if (project.columns.some((c) => c.id === "done")) return columnId === "done";
  const last = [...project.columns].sort((a, b) => a.order - b.order).pop();
  return last?.id === columnId;
}
