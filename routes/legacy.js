const express = require("express");
const router = express.Router();

/**
 * Legacy Route Redirects (Backward Compatibility)
 *
 * Catches old unversioned routes and issues 308 Permanent Redirect
 * to their versioned equivalents. 308 preserves the HTTP method and body,
 * so POST /ask → POST /api/v1/ask works correctly.
 *
 * These redirects will be removed in the next major version.
 */

// ── Chat API redirects ─────────────────────────────────────────────────────

router.post("/ask", (req, res) => {
  console.warn("[Legacy] POST /ask → /api/v1/ask (deprecated)");
  res.redirect(308, "/api/v1/ask");
});

router.post("/ask/:sessionId", (req, res) => {
  console.warn(`[Legacy] POST /ask/${req.params.sessionId} → /api/v1/ask/${req.params.sessionId} (deprecated)`);
  res.redirect(308, `/api/v1/ask/${req.params.sessionId}`);
});

router.post("/upload", (req, res) => {
  console.warn("[Legacy] POST /upload → /api/v1/upload (deprecated)");
  res.redirect(308, "/api/v1/upload");
});

router.post("/rename/:sessionId", (req, res) => {
  console.warn(`[Legacy] POST /rename/${req.params.sessionId} → /api/v1/rename/${req.params.sessionId} (deprecated)`);
  res.redirect(308, `/api/v1/rename/${req.params.sessionId}`);
});

router.delete("/session/:sessionId", (req, res) => {
  console.warn(`[Legacy] DELETE /session/${req.params.sessionId} → /api/v1/session/${req.params.sessionId} (deprecated)`);
  res.redirect(308, `/api/v1/session/${req.params.sessionId}`);
});

// ── Auth API redirects ──────────────────────────────────────────────────────

router.post("/create-user", (req, res) => {
  console.warn("[Legacy] POST /create-user → /api/v1/auth/create-user (deprecated)");
  res.redirect(308, "/api/v1/auth/create-user");
});

router.post("/verify-login", (req, res) => {
  console.warn("[Legacy] POST /verify-login → /api/v1/auth/verify-login (deprecated)");
  res.redirect(308, "/api/v1/auth/verify-login");
});

router.get("/logout", (req, res) => {
  console.warn("[Legacy] GET /logout → /api/v1/auth/logout (deprecated)");
  res.redirect(308, "/api/v1/auth/logout");
});

module.exports = router;
