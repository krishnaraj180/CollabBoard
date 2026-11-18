const Activity = require("../models/Activity");
const { emitToWorkspace, emitToProjectWorkspace } = require("../sockets");
const { resolveTenantFromParent } = require("./organizationAccess");

/** Record an activity and scope project events to the assigned project manager. */
async function logActivity(io, {
  workspace,
  project,
  task,
  actor,
  action,
  summary,
  projectManager,
  projectAssignments,
  workflowStage,
  workspaceMembers,
  tenantParent,
}) {
  const workspaceId = workspace?._id || workspace;
  const organizationId = resolveTenantFromParent(tenantParent);
  const doc = await Activity.create({ organizationId, workspace: workspaceId, project, task, actor: actor._id || actor, action, summary });
  const payload = {
    _id: doc._id,
    workspace: String(workspaceId),
    project: project ? String(project) : undefined,
    task: task ? String(task) : undefined,
    action,
    summary,
    actor: { _id: actor._id, name: actor.name, avatarColor: actor.avatarColor },
    createdAt: doc.createdAt,
  };
  if (io) {
    if (workspaceMembers) {
      emitToProjectWorkspace(io, workspaceMembers, {
        projectManager,
        departmentAssignments: projectAssignments,
        workflowStage,
      }, "activity:new", payload);
    } else {
      emitToWorkspace(io, workspace, "activity:new", payload);
    }
  }
  return payload;
}

module.exports = { logActivity };
