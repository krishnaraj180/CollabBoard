const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { env } = require("../config/env");
const { AppError } = require("../utils/errors");

const dest = path.resolve(__dirname, "../../", env.uploadDir);
fs.mkdirSync(dest, { recursive: true });

const allowed = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const storage = multer.diskStorage({
  destination: dest,
  filename: (req, file, cb) => {
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).slice(0, 8)}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxFileMb * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    if (!allowed.has(file.mimetype)) {
      return cb(new AppError("File type is not allowed", 400));
    }
    cb(null, true);
  },
});

module.exports = { upload, dest };
