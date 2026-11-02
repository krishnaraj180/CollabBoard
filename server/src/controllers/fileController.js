const fs = require("fs");
const path = require("path");
const { dest } = require("../middleware/upload");
const { AppError, asyncHandler } = require("../utils/errors");

const ALLOWED = /^[\w.\-]+$/;

const serve = asyncHandler(async (req, res) => {
  const name = req.params.filename;
  if (!ALLOWED.test(name)) throw new AppError("Invalid filename", 400);
  const filePath = path.join(dest, name);
  if (!filePath.startsWith(dest)) throw new AppError("Invalid filename", 400);
  if (!fs.existsSync(filePath)) throw new AppError("File not found", 404);
  res.sendFile(filePath);
});

module.exports = { serve };
