const PROTECTED_ASSIGNMENT_FIELDS = [
  "organizationId",
  "ownerId",
  "members",
  "role",
  "permissions",
  "status",
  "createdBy",
];

function rejectProtectedFields(value, ctx, allowed = []) {
  for (const field of PROTECTED_ASSIGNMENT_FIELDS) {
    if (allowed.includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      ctx.addIssue({ code: "custom", path: [field], message: `${field} is server-managed` });
    }
  }
}

function secureBody(schema, allowedProtectedFields = []) {
  return require("zod").z.preprocess((value, ctx) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      rejectProtectedFields(value, ctx, allowedProtectedFields);
    }
    return value;
  }, schema);
}

module.exports = { PROTECTED_ASSIGNMENT_FIELDS, secureBody };
