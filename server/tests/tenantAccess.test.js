const mongoose = require("mongoose");
const Workspace = require("../src/models/Workspace");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { legacyWorkspaceMembership, getMembership, enforcementMode } = require("../src/services/tenantAccess");
const { tenantNotFound, organizationSuspended } = require("../src/utils/tenantErrors");

describe("central tenant access policy", () => {
  const userId = new mongoose.Types.ObjectId();
  const orgId = new mongoose.Types.ObjectId();

  afterEach(() => jest.restoreAllMocks());

  test("legacy access uses direct workspace membership only", () => {
    const workspace = new Workspace({ name: "Legacy", members: [{ user: userId, role: "member" }] });
    expect(legacyWorkspaceMembership(workspace, userId)).toEqual(expect.objectContaining({ role: "member" }));
    expect(legacyWorkspaceMembership(workspace, new mongoose.Types.ObjectId())).toBeNull();
    workspace.organizationId = orgId;
    expect(legacyWorkspaceMembership(workspace, userId)).toBeNull();
  });

  test("duplicate memberships choose revoked over suspended over active", async () => {
    const find = jest.spyOn(OrganizationMembership, "find").mockReturnValue({
      select: () => ({
        lean: async () => [
          { status: "active", role: "organization_owner" },
          { status: "suspended", role: "viewer" },
          { status: "revoked", role: "viewer" },
        ],
      }),
    });
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getMembership(userId, orgId)).resolves.toBeNull();
    expect(find).toHaveBeenCalledWith({ userId, organizationId: orgId });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warning.mock.calls[0][0])).toEqual(expect.objectContaining({ event: "tenant.duplicate_membership" }));
  });

  test("active duplicate memberships keep the lowest-permission role", async () => {
    jest.spyOn(OrganizationMembership, "find").mockReturnValue({
      select: () => ({
        lean: async () => [
          { status: "active", role: "organization_admin" },
          { status: "active", role: "viewer" },
        ],
      }),
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getMembership(userId, orgId)).resolves.toEqual(expect.objectContaining({ role: "viewer" }));
  });

  test("tenant errors have stable codes and statuses", () => {
    expect(tenantNotFound()).toEqual(expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" }));
    expect(organizationSuspended()).toEqual(expect.objectContaining({ status: 403, code: "ORG_SUSPENDED" }));
    expect(enforcementMode()).toBe("off");
  });
});
