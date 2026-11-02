const express = require("express");
const chat = require("../controllers/chatController");
const { upload } = require("../middleware/upload");

const router = express.Router();

router.get("/:channelId/messages", chat.listMessages);
router.post("/:channelId/messages", upload.array("files", 4), chat.createMessage);

module.exports = router;
