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
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "", maxlength: 4000 },
    attachments: { type: [attachmentSchema], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

messageSchema.index({ channel: 1, createdAt: -1 });
messageSchema.index({ organizationId: 1, channel: 1, createdAt: -1 }, { background: true });

module.exports = mongoose.model("Message", messageSchema);
