/**
 * Test Helpers
 *
 * Shared utilities for building the Express app in test mode,
 * creating test users, and generating auth tokens.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const jwt = require("jsonwebtoken");

// Ensure env vars are set (globalSetup should have done this)
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-for-testing";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-key-for-testing";

/**
 * Build a minimal Express app wired the same way as server.js,
 * but without helmet/compression/morgan/view-engine so we can
 * test routes in isolation with supertest.
 */
function buildApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    })
  );

  // Mount routes exactly like server.js
  const { pageRouter: authPageRoutes, apiRouter: authApiRoutes } = require("../routes/auth");
  const { pageRouter: chatPageRoutes, apiRouter: chatApiRoutes } = require("../routes/chat");
  const legacyRedirects = require("../routes/legacy");

  // Simple view engine stub so res.render doesn't crash
  app.set("view engine", "ejs");
  app.set("views", require("path").join(__dirname, "..", "views"));

  // Health check
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Page routes
  app.use("/", authPageRoutes);
  app.use("/", chatPageRoutes);

  // Versioned API routes
  app.use("/api/v1", chatApiRoutes);
  app.use("/api/v1/auth", authApiRoutes);

  // Legacy redirects
  app.use("/", legacyRedirects);

  return app;
}

/**
 * Generate a signed JWT cookie value for a given email.
 */
function generateAuthToken(email) {
  return jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

/**
 * Create a test user in the database and return the user document + auth token.
 */
async function createTestUser(userModel, overrides = {}) {
  const bcrypt = require("bcrypt");
  const defaults = {
    fullName: "Test User",
    email: `test-${Date.now()}@example.com`,
    password: "password123",
  };
  const data = { ...defaults, ...overrides };

  const hash = await bcrypt.hash(data.password, 4); // low rounds for speed
  const user = await userModel.create({
    fullName: data.fullName,
    email: data.email,
    password: hash,
    session: [],
  });

  const token = generateAuthToken(data.email);
  return { user, token, rawPassword: data.password };
}

module.exports = { buildApp, generateAuthToken, createTestUser };
