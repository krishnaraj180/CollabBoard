const { PERMISSIONS } = require("../config/permissionCatalog");

const allPermissions = [...PERMISSIONS];
const SYSTEM_ROLE_DEFINITIONS = Object.freeze([
  { key: "owner", name: "Owner", legacyRoles: ["organization_owner", "owner"], permissions: allPermissions },
  { key: "admin", name: "Admin", legacyRoles: ["organization_admin", "admin"], permissions: ["organization:read", "organization:update", "organization:invite", "organization:members", "organization:departments", "organization:workspaces", "organization:reports", "organization:proposals", "org.manage_roles", "workspace:update", "workspace:organization_update", "member:invite", "member:remove", "member:role", "project:create", "project:update", "project:delete"] },
  { key: "project_manager", name: "Project Manager", legacyRoles: ["project_manager"], permissions: ["organization:read", "organization:reports", "project:create", "project:update"] },
  { key: "dev_lead", name: "Dev Lead", legacyRoles: ["engineering_manager", "development_team_lead", "team_lead"], permissions: ["organization:read", "organization:reports"] },
  { key: "qa", name: "QA", legacyRoles: ["qa_manager", "qa_team_lead", "qa_engineer", "qa_tester"], permissions: ["organization:read", "organization:reports"] },
  { key: "devops", name: "DevOps", legacyRoles: ["devops_manager", "devops_team_lead", "devops_engineer"], permissions: ["organization:read"] },
  { key: "marketing", name: "Marketing", legacyRoles: ["marketing_manager", "marketing_team_lead", "marketing_executive", "marketing"], permissions: ["organization:read"] },
  { key: "finance", name: "Finance", legacyRoles: ["finance_manager", "accountant", "finance_executive", "finance"], permissions: ["organization:read"] },
  { key: "business_management", name: "Business Management", legacyRoles: ["business_management"], permissions: ["organization:read", "organization:proposals"] },
  { key: "member", name: "Member", legacyRoles: ["member", "developer", "frontend_developer", "backend_developer", "react_developer", "ui_developer", "nodejs_developer", "java_developer", "python_developer", "design_manager", "design_team_lead", "ui_ux_designer", "hr_manager", "hr_executive", "recruiter", "hr_employee"], permissions: ["organization:read"] },
  { key: "viewer", name: "Viewer", legacyRoles: ["viewer"], permissions: ["organization:read", "organization:reports"] },
]);

const byLegacyRole = new Map(SYSTEM_ROLE_DEFINITIONS.flatMap((definition) => definition.legacyRoles.map((role) => [role, definition])));
const byKey = new Map(SYSTEM_ROLE_DEFINITIONS.map((definition) => [definition.key, definition]));

function legacyToSystemRole(legacyRole) {
  return byLegacyRole.get(legacyRole) || byKey.get("viewer");
}

function systemRoleByKey(key) {
  return byKey.get(key) || null;
}

module.exports = { SYSTEM_ROLE_DEFINITIONS, legacyToSystemRole, systemRoleByKey };
