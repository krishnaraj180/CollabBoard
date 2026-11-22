const mongoose = require("mongoose");
const { assertKnownPermissions } = require("../config/permissionCatalog");

const roleSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    key: { type: String, required: true, trim: true, maxlength: 80 },
    permissions: {
      type: [String],
      default: [],
      validate: { validator: (permissions) => { assertKnownPermissions(permissions); return true; }, message: "Unknown permission string" },
    },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

roleSchema.index({ organizationId: 1, name: 1 }, { unique: true });
roleSchema.index({ organizationId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Role", roleSchema);
