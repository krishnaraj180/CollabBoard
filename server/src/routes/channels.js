const express = require("express");
const chat = require("../controllers/chatController");
const { validate } = require("../middleware/validate");
const { authorizeChannelMessage } = require("../middleware/channelMessageAccess");
const { upload } = require("../middleware/upload");

const router = express.Router();

router.get("/:channelId/messages", chat.listMessages);
router.post("/:channelId/messages", authorizeChannelMessage, upload.array("files", 4), chat.createMessage);
router.patch("/:channelId/messages/:messageId", validate(chat.messageUpdateSchema), chat.updateMessage);
router.delete("/:channelId/messages/:messageId", chat.deleteMessage);
router.post("/:channelId/messages/:messageId/read", validate(chat.messageReadSchema), chat.markMessageRead);

module.exports = router;
