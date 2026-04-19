const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const userModel = require("../dbmodels/user");
const { setAuthCookie } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");
const {
  signupValidation,
  loginValidation,
  handleValidationErrors,
} = require("../middleware/validators");
const { migrateGuestSession } = require("../services/sessionMigration");

// ═══════════════════════════════════════════════════════════════════════════
// PAGE ROUTES — mounted at "/" in server.js
// ═══════════════════════════════════════════════════════════════════════════

const pageRouter = express.Router();

pageRouter.get("/login", (req, res) => {
  res.redirect("/login/0");
});

pageRouter.get("/login/:loginStatus", (req, res) => {
  const loginStatus = req.params.loginStatus;
  res.render("login", { loginStatus });
});

// ═══════════════════════════════════════════════════════════════════════════
// API ROUTES — mounted at "/api/v1/auth" in server.js
// ═══════════════════════════════════════════════════════════════════════════

const apiRouter = express.Router();

// ── Signup ───────────────────────────────────────────────────────────────────

apiRouter.post(
  "/create-user",
  authLimiter,
  signupValidation,
  handleValidationErrors,
  async (req, res) => {
    const { fullName, email, password } = req.body;

    try {
      // Check if user already exists
      const existingUser = await userModel.findOne({ email });
      if (existingUser) {
        return res.status(409).json({ error: "User with this email already exists", redirect: "/login/1" });
      }

      // Hash password (using async/await instead of callbacks)
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);

      // Create user FIRST, then set cookie
      const newUser = await userModel.create({
        fullName,
        email,
        password: hash,
      });

      // Set auth cookie after user is confirmed created
      setAuthCookie(res, email);

      // Migrate guest session if one exists
      const migratedSessionId = await migrateGuestSession(req, newUser);
      const redirect = migratedSessionId ? `/chat/${migratedSessionId}` : "/";

      res.status(201).json({
        success: true,
        redirect,
        migrated: !!migratedSessionId,
      });
    } catch (e) {
      console.error("[Auth] Error creating user:", e.message);
      res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  }
);

// ── Login ────────────────────────────────────────────────────────────────────

apiRouter.post(
  "/verify-login",
  authLimiter,
  loginValidation,
  handleValidationErrors,
  async (req, res) => {
    const { email, password } = req.body;

    try {
      const existingUser = await userModel.findOne({ email });
      if (!existingUser) {
        return res.status(401).json({ error: "Email or Password incorrect", redirect: "/login/2" });
      }

      const isMatch = await bcrypt.compare(password, existingUser.password);
      if (isMatch) {
        setAuthCookie(res, email);

        // Migrate guest session if one exists
        const migratedSessionId = await migrateGuestSession(req, existingUser);
        const redirect = migratedSessionId ? `/chat/${migratedSessionId}` : "/";

        return res.status(200).json({
          success: true,
          redirect,
          migrated: !!migratedSessionId,
        });
      } else {
        return res.status(401).json({ error: "Email or Password incorrect", redirect: "/login/2" });
      }
    } catch (e) {
      console.error("[Auth] Error verifying login:", e.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// ── Logout ───────────────────────────────────────────────────────────────────

apiRouter.get("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "Strict",
  });
  res.redirect("/");
});

module.exports = { pageRouter, apiRouter };
