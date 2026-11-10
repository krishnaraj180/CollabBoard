const express = require("express");
const { validate } = require("../middleware/validate");
const workspaces = require("../controllers/workspaceController");
const projects = require("../controllers/projectController");
const chat = require("../controllers/chatController");

const router = express.Router();

router.get("/", workspaces.list);
router.post("/", validate(workspaces.createSchema), workspaces.create);
router.get("/:id", workspaces.getOne);
router.patch("/:id", validate(workspaces.updateSchema), workspaces.update);
router.post("/:id/invites", validate(workspaces.inviteSchema), workspaces.invite);
router.patch("/:id/members/:userId", validate(workspaces.roleSchema), workspaces.updateRole);
router.patch("/:id/members/:userId/organization", validate(workspaces.organizationMemberSchema), workspaces.updateOrganizationMember);
router.patch("/:id/organization", validate(workspaces.organizationSchema), workspaces.updateOrganization);
router.delete("/:id/members/:userId", workspaces.removeMember);

router.get("/:workspaceId/projects", projects.list);
router.post("/:workspaceId/projects", validate(projects.createSchema), projects.create);

router.get("/:workspaceId/dashboard", projects.dashboard);
router.get("/:workspaceId/my-tasks", projects.myTasks);
router.get("/:workspaceId/activity", projects.workspaceActivity);

router.get("/:workspaceId/channels", chat.listChannels);
router.post("/:workspaceId/channels", validate(chat.channelSchema), chat.createChannel);

module.exports = router;
