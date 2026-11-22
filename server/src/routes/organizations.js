const express = require("express");
const { validate } = require("../middleware/validate");
const organizations = require("../controllers/organizationController");
const { resolveOrganizationContext } = require("../middleware/organizationContext");
const roleController = require("../controllers/roleController");

const router = express.Router();

router.post("/", validate(organizations.createSchema), organizations.create);
router.get("/", organizations.list);
router.post("/invitations/accept", validate(organizations.acceptInvitationSchema), organizations.acceptInvitation);
router.use("/:id", resolveOrganizationContext);
router.get("/:id", organizations.getOne);
router.patch("/:id", validate(organizations.updateSchema), organizations.update);
router.get("/:id/roles", roleController.list);
router.post("/:id/roles", validate(roleController.roleCreateSchema), roleController.create);
router.patch("/:id/roles/:roleId", validate(roleController.roleUpdateSchema), roleController.update);
router.delete("/:id/roles/:roleId", validate(roleController.roleDeleteSchema), roleController.remove);
router.put("/:id/members/:userId/role", validate(roleController.roleAssignmentSchema), roleController.assign);
router.get("/:id/proposals", organizations.listProposals);
router.post("/:id/proposals", validate(organizations.proposalCreateSchema), organizations.createProposal);
router.post("/:id/proposals/:proposalId/decision", validate(organizations.proposalDecisionSchema), organizations.decideProposal);
router.post("/:id/locations", validate(organizations.locationCreateSchema), organizations.createLocation);
router.patch("/:id/locations/:locationId", validate(organizations.locationUpdateSchema), organizations.updateLocation);
router.delete("/:id/locations/:locationId", validate(organizations.locationDeleteSchema), organizations.removeLocation);
router.get("/:id/workload", organizations.workload);
router.post("/:id/invitations", validate(organizations.inviteSchema), organizations.inviteMember);
router.get("/:id/invitations", organizations.listInvitations);
router.delete("/:id/invitations/:invitationId", organizations.revokeInvitation);
router.patch("/:id/members/:userId", validate(organizations.memberUpdateSchema), organizations.updateMember);
router.delete("/:id/members/:userId", organizations.removeMember);
router.post("/:id/departments", validate(organizations.departmentCreateSchema), organizations.createDepartment);
router.patch("/:id/departments/:departmentId", validate(organizations.departmentUpdateSchema), organizations.updateDepartment);
router.delete("/:id/departments/:departmentId", organizations.removeDepartment);
router.put("/:id/workspaces/:workspaceId", validate(organizations.workspaceLinkSchema), organizations.linkWorkspace);
router.delete("/:id/workspaces/:workspaceId", validate(organizations.workspaceLinkSchema), organizations.unlinkWorkspace);

module.exports = router;
