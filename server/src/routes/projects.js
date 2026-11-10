const express = require("express");
const { validate } = require("../middleware/validate");
const projects = require("../controllers/projectController");

const router = express.Router();

router.get("/:id", projects.getBoard);
router.patch("/:id", validate(projects.projectUpdateSchema), projects.updateProject);
router.post("/:id/workflow", validate(projects.workflowTransitionSchema), projects.transitionWorkflow);
router.delete("/:id", projects.removeProject);
router.get("/:id/activity", projects.projectActivity);
router.post("/:id/tasks", validate(projects.taskCreateSchema), projects.createTask);
router.patch("/:id/tasks/:taskId", validate(projects.taskUpdateSchema), projects.updateTask);
router.delete("/:id/tasks/:taskId", projects.removeTask);
router.post("/:id/tasks/:taskId/comments", validate(projects.commentSchema), projects.addComment);
router.delete("/:id/tasks/:taskId/comments/:commentId", projects.removeComment);

module.exports = router;
