const Activity = require("../models/Activity");
const { emitToWorkspace } = require("../sockets");

/** Record something that happened and push it to everyone in the workspace. */
async function logActivity(io, { workspace, project, task, actor, action, summary }) {
  const doc = await Activity.create({ workspace, project, task, actor: actor._id || actor, action, summary });
  const payload = {
    _id: doc._id,
    workspace: String(workspace),
    project: project ? String(project) : undefined,
    task: task ? String(task) : undefined,
    action,
    summary,
    actor: { _id: actor._id, name: actor.name, avatarColor: actor.avatarColor },
    createdAt: doc.createdAt,
  };
  if (io) emitToWorkspace(io, workspace, "activity:new", payload);
  return payload;
}

module.exports = { logActivity };
