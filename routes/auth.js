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

// ── Login Page ──────────────────────────────────────────────────────────────

router.get("/login", (req, res) => {
  res.redirect("/login/0");
});

router.get("/login/:loginStatus", (req, res) => {
  const loginStatus = req.params.loginStatus;
  res.render("login", { loginStatus });
});

// ── Signup ───────────────────────────────────────────────────────────────────

router.post(
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
      await userModel.create({
        fullName,
        email,
        password: hash,
      });

      // Set auth cookie after user is confirmed created
      setAuthCookie(res, email);
      res.status(201).json({ success: true, redirect: "/" });
    } catch (e) {
      console.error("[Auth] Error creating user:", e.message);
      res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  }
);

// ── Login ────────────────────────────────────────────────────────────────────

router.post(
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
        return res.status(200).json({ success: true, redirect: "/" });
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

router.get("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "Strict",
  });
  res.redirect("/");
});

module.exports = router;
