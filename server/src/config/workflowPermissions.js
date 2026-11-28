const WORKFLOW_STAGES = [
  "business_approval",
  "technical_review",
  "project_setup",
  "team_assignment",
  "design",
  "development",
  "code_review",
  "qa_testing",
  "bug_fixing",
  "deployment",
  "production_release",
  "marketing_launch",
  "finance_review",
  "delivery_review",
  "executive_review",
];

const WORKFLOW_TRANSITIONS = {
  business_approval: { action: "approve", next: "technical_review", roles: ["managing_director"] },
  technical_review: { action: "approve", next: "project_setup", roles: ["cto"] },
  project_setup: { action: "submit", next: "team_assignment", roles: ["project_manager"] },
  team_assignment: { action: "submit", next: "design", roles: ["project_manager"] },
  design: { action: "complete", next: "development", departments: ["Design Department"], roles: ["design_manager", "design_team_lead", "ui_ux_designer"] },
  development: { action: "complete", next: "code_review", departments: ["Development Department", "Frontend Team", "Backend Team"], roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] },
  code_review: { action: "approve", next: "qa_testing", departments: ["Development Department"], roles: ["engineering_manager", "team_lead", "development_team_lead"] },
  qa_testing: { action: "pass", next: "deployment", departments: ["QA Department"], roles: ["qa_manager", "qa_team_lead", "qa_engineer"] },
  bug_fixing: { action: "complete", next: "code_review", departments: ["Development Department", "Frontend Team", "Backend Team"], roles: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"] },
  deployment: { action: "deploy", next: "production_release", departments: ["DevOps Department"], roles: ["devops_manager", "devops_team_lead", "devops_engineer"] },
  production_release: { action: "release", next: "marketing_launch", departments: ["DevOps Department"], roles: ["devops_manager", "devops_team_lead", "devops_engineer"] },
  marketing_launch: { action: "launch", next: "finance_review", departments: ["Marketing Department"], roles: ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"] },
  finance_review: { action: "complete", next: "delivery_review", departments: ["Finance Department"], roles: ["finance_manager", "accountant", "finance_executive", "finance"] },
  delivery_review: { action: "complete", next: "executive_review", roles: ["project_manager"] },
  executive_review: { action: "complete", next: "completed", roles: ["ceo", "managing_director"] },
};

const WORKFLOW_STAGE_DEPARTMENTS = Object.freeze(Object.fromEntries(
  WORKFLOW_STAGES.map((stage) => [stage, WORKFLOW_TRANSITIONS[stage]?.departments || []])
));

const TASK_STAGE_ROLES = Object.freeze({
  design: ["design_manager", "design_team_lead", "ui_ux_designer"],
  development: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
  bug_fixing: ["engineering_manager", "team_lead", "development_team_lead", "frontend_developer", "react_developer", "ui_developer", "backend_developer", "nodejs_developer", "java_developer", "python_developer"],
});

const WORKFLOW_PERMISSIONS = Object.freeze([
  "workflow:business_approval:approve",
  "workflow:technical_review:approve",
  "workflow:project_setup:edit_plan",
  "workflow:project_setup:submit",
  "workflow:team_assignment:edit",
  "workflow:team_assignment:submit",
  "workflow:design:complete",
  "workflow:design:add_team_member",
  "workflow:design:edit_task",
  "workflow:development:complete",
  "workflow:development:add_team_member",
  "workflow:development:edit_task",
  "workflow:code_review:approve",
  "workflow:code_review:request_changes",
  "workflow:qa_testing:pass",
  "workflow:qa_testing:fail",
  "workflow:qa_testing:edit_task",
  "workflow:bug_fixing:complete",
  "workflow:bug_fixing:add_team_member",
  "workflow:bug_fixing:edit_task",
  "workflow:deployment:deploy",
  "workflow:production_release:release",
  "workflow:marketing_launch:launch",
  "workflow:finance_review:complete",
  "workflow:delivery_review:complete",
  "workflow:executive_review:complete",
  "workflow:override",
]);

const all = [...WORKFLOW_PERMISSIONS];
const transition = (stage, action) => `workflow:${stage}:${action}`;
const permissions = (...values) => values.map(([stage, action]) => transition(stage, action));
const developmentTaskPermissions = permissions(["development", "edit_task"], ["bug_fixing", "edit_task"]);

// Single workspace-role table shared by legacy and organization-linked workspaces.
const WORKSPACE_WORKFLOW_PERMISSIONS = Object.freeze({
  owner: [...all],
  admin: [],
  ceo: [transition("executive_review", "complete"), transition("design", "add_team_member"), transition("development", "add_team_member"), transition("bug_fixing", "add_team_member")],
  managing_director: [transition("business_approval", "approve"), transition("executive_review", "complete"), transition("design", "add_team_member"), transition("development", "add_team_member"), transition("bug_fixing", "add_team_member")],
  cto: [transition("technical_review", "approve")],
  project_manager: [
    transition("project_setup", "edit_plan"), transition("project_setup", "submit"),
    transition("team_assignment", "edit"), transition("team_assignment", "submit"),
    transition("delivery_review", "complete"),
    transition("design", "add_team_member"), transition("development", "add_team_member"), transition("bug_fixing", "add_team_member"),
  ],
  engineering_manager: [...developmentTaskPermissions, transition("development", "complete"), transition("code_review", "approve"), transition("code_review", "request_changes"), transition("bug_fixing", "complete")],
  team_lead: [...developmentTaskPermissions, transition("development", "complete"), transition("code_review", "approve"), transition("code_review", "request_changes"), transition("bug_fixing", "complete")],
  development_team_lead: [...developmentTaskPermissions, transition("development", "complete"), transition("code_review", "approve"), transition("code_review", "request_changes"), transition("bug_fixing", "complete")],
  frontend_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  react_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  ui_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  backend_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  nodejs_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  java_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  python_developer: [...developmentTaskPermissions, transition("development", "complete"), transition("bug_fixing", "complete")],
  design_manager: [transition("design", "complete"), transition("design", "edit_task")],
  design_team_lead: [transition("design", "complete"), transition("design", "edit_task")],
  ui_ux_designer: [transition("design", "complete"), transition("design", "edit_task")],
  qa_manager: [transition("qa_testing", "pass"), transition("qa_testing", "fail"), transition("qa_testing", "edit_task")],
  qa_team_lead: [transition("qa_testing", "pass"), transition("qa_testing", "fail"), transition("qa_testing", "edit_task")],
  qa_engineer: [transition("qa_testing", "pass"), transition("qa_testing", "fail"), transition("qa_testing", "edit_task")],
  devops_manager: [transition("deployment", "deploy"), transition("production_release", "release")],
  devops_team_lead: [transition("deployment", "deploy"), transition("production_release", "release")],
  devops_engineer: [transition("deployment", "deploy"), transition("production_release", "release")],
  marketing_manager: [transition("marketing_launch", "launch")],
  marketing_team_lead: [transition("marketing_launch", "launch")],
  marketing_executive: [transition("marketing_launch", "launch")],
  marketing: [transition("marketing_launch", "launch")],
  finance_manager: [transition("finance_review", "complete")],
  accountant: [transition("finance_review", "complete")],
  finance_executive: [transition("finance_review", "complete")],
  finance: [transition("finance_review", "complete")],
  hr_manager: [],
  hr_executive: [],
  recruiter: [],
  hr_employee: [],
  member: [],
  viewer: [],
});

function workflowPermission(stage, action) {
  return transition(stage, action);
}

function hasWorkflowPermission(role, stage, action) {
  return Boolean(WORKSPACE_WORKFLOW_PERMISSIONS[role]?.includes(workflowPermission(stage, action)));
}

function legacyWorkflowRoleAllowed(role, stage, action) {
  const transitionDefinition = WORKFLOW_TRANSITIONS[stage];
  return role === "owner" || Boolean(transitionDefinition?.roles.includes(role));
}

module.exports = {
  WORKFLOW_STAGES,
  WORKFLOW_TRANSITIONS,
  WORKFLOW_STAGE_DEPARTMENTS,
  TASK_STAGE_ROLES,
  WORKFLOW_PERMISSIONS,
  WORKSPACE_WORKFLOW_PERMISSIONS,
  workflowPermission,
  hasWorkflowPermission,
  legacyWorkflowRoleAllowed,
};
