const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    mimeType: String,
    size: Number,
    url: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "", maxlength: 4000 },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

messageSchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
