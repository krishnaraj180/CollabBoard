const mongoose = require("mongoose");

const decisionSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["approved", "rejected"], required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

const projectProposalSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    clientName: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 400 },
    quotation: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ },
    startDate: { type: Date, required: true },
    expectedCompletionDate: { type: Date, required: true },
    status: { type: String, enum: ["pending_ceo", "approving", "approved", "rejected"], default: "pending_ceo" },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    decision: { type: decisionSchema, default: null },
    locations: [{ type: mongoose.Schema.Types.ObjectId }],
    projects: [{ type: mongoose.Schema.Types.ObjectId, ref: "Project" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProjectProposal", projectProposalSchema);
