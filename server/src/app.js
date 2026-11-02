const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { env } = require("./config/env");
const { errorHandler, AppError } = require("./utils/errors");
const { requireAuth } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const workspaceRoutes = require("./routes/workspaces");
const projectRoutes = require("./routes/projects");
const channelRoutes = require("./routes/channels");
const notificationController = require("./controllers/notificationController");
const fileController = require("./controllers/fileController");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.set("etag", false);
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "collabboard" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/workspaces", requireAuth, workspaceRoutes);
  app.use("/api/projects", requireAuth, projectRoutes);
  app.use("/api/channels", requireAuth, channelRoutes);
  app.get("/api/notifications", requireAuth, notificationController.list);
  app.post("/api/notifications/read", requireAuth, notificationController.markRead);
  app.get("/api/files/:filename", requireAuth, fileController.serve);

  app.use("/api", (req, res, next) => next(new AppError("Not found", 404)));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
