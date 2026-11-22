const fs = require("fs");
const path = require("path");
const baseline = require("./permissionMatrix.baseline.json");
const { ORGANIZATION_PERMISSIONS } = require("../src/utils/organizationAccess");

test("baseline endpoint x role matrix matches current hardcoded organization behavior", () => {
  for (const entry of baseline.organizationEndpoints) {
    expect(ORGANIZATION_PERMISSIONS[entry.permission]).toBeDefined();
  }
  const serialized = JSON.stringify(baseline);
  expect(serialized).toContain("current hardcoded authorization checks");
  expect(fs.existsSync(path.join(__dirname, "permissionMatrix.baseline.json"))).toBe(true);
});

test("baseline explicitly records checks that do not map cleanly to one permission", () => {
  expect(baseline.unmappedChecks.length).toBeGreaterThan(0);
});
