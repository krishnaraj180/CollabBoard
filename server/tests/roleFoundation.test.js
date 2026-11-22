const mongoose = require("mongoose");
const Role = require("../src/models/Role");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { PERMISSIONS, assertKnownPermissions } = require("../src/config/permissionCatalog");
const { SYSTEM_ROLE_DEFINITIONS, legacyToSystemRole } = require("../src/services/roleMapping");
const { createMembership, syncMembershipRole } = require("../src/utils/organizationMembership");
const { startDb, stopDb, clearDb } = require("./helpers");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

test("permission catalog rejects unknown strings", () => {
  expect(() => assertKnownPermissions(["organization:read", "organization:not-real"])).toThrow("Unknown permission");
  expect(PERMISSIONS).toContain("organization:read");
});

test("every legacy role maps through one function and unknown roles use least privilege", () => {
  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    for (const legacyRole of definition.legacyRoles) expect(legacyToSystemRole(legacyRole).key).toBe(definition.key);
  }
  expect(legacyToSystemRole("unmapped_legacy_role").key).toBe("viewer");
});

test("membership dual-write keeps legacy role and roleId aligned", async () => {
  const organizationA = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const adminRole = await Role.create({ organizationId: organizationA, name: "Admin", key: "admin", permissions: ["organization:read"], isSystem: true });
  const viewerRole = await Role.create({ organizationId: organizationA, name: "Viewer", key: "viewer", permissions: ["organization:read"], isSystem: true });
  const membership = await createMembership({ organizationId: organizationA, userId, role: "organization_admin" });
  expect(String(membership.roleId)).toBe(String(adminRole._id));
  await syncMembershipRole(membership, "viewer");
  await membership.save();
  const saved = await OrganizationMembership.findById(membership._id).lean();
  expect(saved.role).toBe("viewer");
  expect(String(saved.roleId)).toBe(String(viewerRole._id));
});

test("the same system role name is tenant-local", async () => {
  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();
  await Role.create({ organizationId: a, name: "Custom", key: "custom", permissions: ["organization:read"] });
  await expect(Role.create({ organizationId: b, name: "Custom", key: "custom", permissions: ["organization:read"] })).resolves.toBeDefined();
});
