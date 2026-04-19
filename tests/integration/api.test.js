/**
 * API Endpoint Tests
 *
 * Tests for infrastructure endpoints (health, 404), legacy redirect behavior,
 * and auth middleware blocking unauthorized access.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const { buildApp, generateAuthToken } = require("../helpers");

let app;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  app = buildApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /health", () => {
  it("should return 200 with status ok", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.status).toBe("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Route Redirects (308 Permanent Redirect)
// ═══════════════════════════════════════════════════════════════════════════

describe("Legacy Route Redirects", () => {
  it("POST /ask should redirect to /api/v1/ask with 308", async () => {
    const res = await request(app)
      .post("/ask")
      .send({ question: "test" })
      .expect(308);

    expect(res.headers.location).toBe("/api/v1/ask");
  });

  it("POST /ask/:sessionId should redirect to /api/v1/ask/:sessionId", async () => {
    const res = await request(app)
      .post("/ask/some-session-id")
      .send({ question: "test" })
      .expect(308);

    expect(res.headers.location).toBe("/api/v1/ask/some-session-id");
  });

  it("POST /upload should redirect to /api/v1/upload", async () => {
    const res = await request(app).post("/upload").expect(308);

    expect(res.headers.location).toBe("/api/v1/upload");
  });

  it("POST /create-user should redirect to /api/v1/auth/create-user", async () => {
    const res = await request(app)
      .post("/create-user")
      .send({ fullName: "Test", email: "t@t.com", password: "123456" })
      .expect(308);

    expect(res.headers.location).toBe("/api/v1/auth/create-user");
  });

  it("POST /verify-login should redirect to /api/v1/auth/verify-login", async () => {
    const res = await request(app)
      .post("/verify-login")
      .send({ email: "t@t.com", password: "123456" })
      .expect(308);

    expect(res.headers.location).toBe("/api/v1/auth/verify-login");
  });

  it("GET /logout should redirect to /api/v1/auth/logout", async () => {
    const res = await request(app).get("/logout").expect(308);

    expect(res.headers.location).toBe("/api/v1/auth/logout");
  });

  it("POST /rename/:sessionId should redirect to /api/v1/rename/:sessionId", async () => {
    const res = await request(app)
      .post("/rename/abc123")
      .send({ newTitle: "Test" })
      .expect(308);

    expect(res.headers.location).toBe("/api/v1/rename/abc123");
  });

  it("DELETE /session/:sessionId should redirect to /api/v1/session/:sessionId", async () => {
    const res = await request(app).delete("/session/abc123").expect(308);

    expect(res.headers.location).toBe("/api/v1/session/abc123");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth Middleware — Blocking Unauthorized Access
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth Middleware", () => {
  it("should block /api/v1/rename without auth", async () => {
    const res = await request(app)
      .post("/api/v1/rename/any-session")
      .send({ newTitle: "Hello" })
      .expect(401);

    expect(res.body.error).toContain("Authentication");
  });

  it("should block /api/v1/session/:id delete without auth", async () => {
    const res = await request(app)
      .delete("/api/v1/session/any-session")
      .expect(401);

    expect(res.body.error).toContain("Authentication");
  });

  it("should reject requests with invalid JWT token", async () => {
    const res = await request(app)
      .post("/api/v1/rename/any-session")
      .set("Cookie", "token=invalid-jwt-garbage")
      .send({ newTitle: "Hello" })
      .expect(401);

    expect(res.body.error).toContain("Authentication");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// API Versioning — Correct Prefix
// ═══════════════════════════════════════════════════════════════════════════

describe("API Versioning", () => {
  it("should accept requests on /api/v1/ prefix", async () => {
    // The ask route requires question validation, so send a valid body.
    // It will return 404 from our handler ("Session not found") which proves
    // the route IS matched — a true missing route would return a generic 404
    // without an "answer" field.
    const res = await request(app)
      .post("/api/v1/ask/test-id")
      .send({ question: "hello", chatHistory: [] });

    // Our handler returns { answer: "Session not found." } with 404,
    // proving the versioned route was matched (not a generic 404).
    expect(res.body.answer).toContain("not found");
  });
});
