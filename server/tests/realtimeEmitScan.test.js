const fs = require("fs");
const path = require("path");

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

test("all socket emits go through realtimeEmit", () => {
  const sourceRoot = path.join(__dirname, "..", "src");
  const offenders = javascriptFiles(sourceRoot)
    .filter((file) => !file.endsWith(path.join("services", "realtimeEmit.js")))
    .flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return [
        /\bio\.emit\s*\(/,
        /\bsocket\.broadcast\b/,
        /\bio\.to\s*\(\s*["'`]/,
        /\bsocket\.to\s*\(\s*["'`]/,
      ].filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
    });
  expect(offenders).toEqual([]);
});
