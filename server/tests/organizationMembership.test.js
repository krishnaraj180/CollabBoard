const mongoose = require("mongoose");
const OrganizationMembership = require("../src/models/OrganizationMembership");
const { assertOwnerInvariant } = require("../src/utils/organizationMembership");
const { createSchema, updateSchema, memberUpdateSchema } = require("../src/controllers/organizationController");

describe("OrganizationMembership", () => {
  test("defines the tenant/user uniqueness index and lifecycle statuses", () => {
    expect(OrganizationMembership.schema.path("status").enumValues).toEqual(["active", "suspended", "revoked"]);
    expect(OrganizationMembership.schema.path("role").enumValues).toContain("organization_owner");
    const uniqueIndex = OrganizationMembership.schema.indexes().find(([keys, options]) =>
      keys.organizationId === 1 && keys.userId === 1 && options.unique === true
    );
    expect(uniqueIndex).toBeDefined();
  });

  test("does not allow the last active owner to be demoted or revoked", async () => {
    const countSpy = jest.spyOn(OrganizationMembership, "countDocuments").mockResolvedValue(0);
    const membership = {
      organizationId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      role: "organization_owner",
      status: "active",
    };

    await expect(assertOwnerInvariant(membership.organizationId, membership, "organization_admin"))
      .rejects.toMatchObject({ status: 409 });
    await expect(assertOwnerInvariant(membership.organizationId, membership, "organization_owner", "revoked"))
      .rejects.toMatchObject({ status: 409 });
    countSpy.mockRestore();
  });

  test("permits an owner change when another active owner remains", async () => {
    const countSpy = jest.spyOn(OrganizationMembership, "countDocuments").mockResolvedValue(1);
    const membership = {
      organizationId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      role: "organization_owner",
      status: "active",
    };

    await expect(assertOwnerInvariant(membership.organizationId, membership, "organization_admin")).resolves.toBeUndefined();
    countSpy.mockRestore();
  });

  test("rejects tenant and protected fields supplied through organization forms", () => {
    expect(() => createSchema.parse({ body: { name: "Acme", organizationId: new mongoose.Types.ObjectId().toString() } }))
      .toThrow();
    expect(() => updateSchema.parse({
      params: { id: new mongoose.Types.ObjectId().toString() },
      body: { ownerId: new mongoose.Types.ObjectId().toString() },
    })).toThrow();
    expect(() => memberUpdateSchema.parse({
      params: { id: new mongoose.Types.ObjectId().toString(), userId: new mongoose.Types.ObjectId().toString() },
      body: { role: "organization_admin", status: "active" },
    })).toThrow();
  });
});
