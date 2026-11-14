const express = require("express");
const { validate } = require("../middleware/validate");
const projects = require("../controllers/projectController");

const router = express.Router();

router.get("/:id", projects.getBoard);
router.patch("/:id", validate(projects.projectUpdateSchema), projects.updateProject);
router.post("/:id/team-members", validate(projects.projectTeamMembersSchema), projects.addProjectTeamMembers);
router.post("/:id/workflow", validate(projects.workflowTransitionSchema), projects.transitionWorkflow);
router.delete("/:id", projects.removeProject);
router.get("/:id/activity", projects.projectActivity);
router.get("/:id/sprints", projects.listSprints);
router.post("/:id/sprints", validate(projects.sprintCreateSchema), projects.createSprint);
router.patch("/:id/sprints/:sprintId", validate(projects.sprintUpdateSchema), projects.updateSprint);
router.post("/:id/sprints/:sprintId/start", validate(projects.emptyBodySchema), projects.startSprint);
router.post("/:id/sprints/:sprintId/complete", validate(projects.emptyBodySchema), projects.completeSprint);
router.get("/:id/milestones", projects.listMilestones);
router.post("/:id/milestones", validate(projects.milestoneCreateSchema), projects.createMilestone);
router.patch("/:id/milestones/:milestoneId", validate(projects.milestoneUpdateSchema), projects.updateMilestone);
router.post("/:id/milestones/:milestoneId/complete", validate(projects.emptyBodySchema), projects.completeMilestone);
router.delete("/:id/milestones/:milestoneId", validate(projects.emptyBodySchema), projects.removeMilestone);
router.post("/:id/tasks", validate(projects.taskCreateSchema), projects.createTask);
router.patch("/:id/tasks/reorder", validate(projects.taskReorderSchema), projects.reorderTasks);
router.patch("/:id/tasks/:taskId", validate(projects.taskUpdateSchema), projects.updateTask);
router.delete("/:id/tasks/:taskId", projects.removeTask);
router.post("/:id/tasks/:taskId/comments", validate(projects.commentSchema), projects.addComment);
router.delete("/:id/tasks/:taskId/comments/:commentId", projects.removeComment);

module.exports = router;
