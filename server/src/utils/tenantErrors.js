class TenantAccessError extends Error {
  constructor(code, status, message = "Resource not found") {
    super(message);
    this.name = "TenantAccessError";
    this.code = code;
    this.status = status;
  }
}

function tenantNotFound() {
  return new TenantAccessError("RESOURCE_NOT_FOUND", 404);
}

function organizationSuspended() {
  return new TenantAccessError("ORG_SUSPENDED", 403, "Organization is suspended");
}

module.exports = { TenantAccessError, tenantNotFound, organizationSuspended };
