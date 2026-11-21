const fs = require("fs");
const path = require("path");

test("realtime access helpers are declarations only and are not wired yet", () => {
  const sourceRoot = path.join(__dirname, "..", "src");
  const accessFile = path.join(sourceRoot, "services", "realtimeAccess.js");
  const source = fs.readFileSync(accessFile, "utf8");
  expect(source).toMatch(/function revokeUser\(/);
  expect(source).toMatch(/function revokeOrganization\(/);
  expect(source).toMatch(/function grantUser\(/);

  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith(".js") && fullPath !== accessFile) files.push(fullPath);
    }
  };
  visit(sourceRoot);
  const callSites = files.flatMap((file) => {
    const text = fs.readFileSync(file, "utf8");
    return ["revokeUser", "revokeOrganization", "grantUser"]
      .filter((name) => new RegExp(`realtimeAccess\\.${name}\\s*\\(`).test(text))
      .map((name) => `${file}:${name}`);
  });
  expect(callSites).toEqual([]);
});
