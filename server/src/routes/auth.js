const express = require("express");
const rateLimit = require("express-rate-limit");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const auth = require("../controllers/authController");

const router = express.Router();

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many auth attempts, try again later" },
});

router.post("/register", authLimit, validate(auth.registerSchema), auth.register);
router.post("/login", authLimit, validate(auth.loginSchema), auth.login);
router.post("/password/forgot", authLimit, validate(auth.resetRequestSchema), auth.requestPasswordReset);
router.post("/password/reset", authLimit, validate(auth.resetSchema), auth.resetPassword);
router.post("/logout", auth.logout);
router.post("/sessions/revoke", requireAuth, auth.revokeSessions);
router.get("/me", requireAuth, auth.me);
router.patch("/me", requireAuth, validate(auth.profileSchema), auth.updateMe);
router.post("/password", requireAuth, authLimit, validate(auth.passwordSchema), auth.changePassword);

module.exports = router;
