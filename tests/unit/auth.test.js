/**
 * Auth Route Tests
 *
 * Tests for POST /api/v1/auth/create-user, POST /api/v1/auth/verify-login,
 * and GET /api/v1/auth/logout.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const { buildApp, createTestUser } = require("../helpers");

let app;
let userModel;

beforeAll(async () => {
  // Connect to the in-memory MongoDB (URI set by globalSetup)
  await mongoose.connect(process.env.MONGODB_URI);
  userModel = require("../../dbmodels/user");
  app = buildApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

afterEach(async () => {
  // Clean users between tests
  await userModel.deleteMany({});
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/create-user
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/create-user", () => {
  it("should create a new user and return 201 with auth cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/create-user")
      .send({
        fullName: "Alice Smith",
        email: "alice@example.com",
        password: "securepass123",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe("/");

    // Verify cookie is set
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith("token="))).toBe(true);

    // Verify user exists in DB
    const user = await userModel.findOne({ email: "alice@example.com" });
    expect(user).not.toBeNull();
    expect(user.fullName).toBe("Alice Smith");
  });

  it("should return 409 for duplicate email", async () => {
    // Create initial user
    await createTestUser(userModel, { email: "dup@example.com" });

    const res = await request(app)
      .post("/api/v1/auth/create-user")
      .send({
        fullName: "Duplicate User",
        email: "dup@example.com",
        password: "password123",
      })
      .expect(409);

    expect(res.body.error).toContain("already exists");
  });

  it("should return 400 for missing fields", async () => {
    const res = await request(app)
      .post("/api/v1/auth/create-user")
      .send({ email: "missing@example.com" })
      .expect(400);

    expect(res.body.error || res.body.errors).toBeDefined();
  });

  it("should return 400 for invalid email format", async () => {
    const res = await request(app)
      .post("/api/v1/auth/create-user")
      .send({
        fullName: "Bad Email",
        email: "not-an-email",
        password: "password123",
      })
      .expect(400);

    expect(res.body.error || res.body.errors).toBeDefined();
  });

  it("should return 400 for short password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/create-user")
      .send({
        fullName: "Short Pass",
        email: "short@example.com",
        password: "abc",
      })
      .expect(400);

    expect(res.body.error || res.body.errors).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/auth/verify-login
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/auth/verify-login", () => {
  beforeEach(async () => {
    await createTestUser(userModel, {
      email: "login@example.com",
      password: "correctpass",
    });
  });

  it("should login successfully with correct credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-login")
      .send({
        email: "login@example.com",
        password: "correctpass",
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe("/");

    // Verify cookie is set
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
  });

  it("should return 401 for wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-login")
      .send({
        email: "login@example.com",
        password: "wrongpassword",
      })
      .expect(401);

    expect(res.body.error).toContain("incorrect");
  });

  it("should return 401 for non-existent email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-login")
      .send({
        email: "nouser@example.com",
        password: "anypassword",
      })
      .expect(401);

    expect(res.body.error).toContain("incorrect");
  });

  it("should return 400 for missing password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-login")
      .send({ email: "login@example.com" })
      .expect(400);

    expect(res.body.error || res.body.errors).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/auth/logout
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/auth/logout", () => {
  it("should clear the auth cookie and redirect", async () => {
    const { token } = await createTestUser(userModel);

    const res = await request(app)
      .get("/api/v1/auth/logout")
      .set("Cookie", `token=${token}`)
      .expect(302);

    // The token cookie should be cleared (set to empty or expired)
    const cookies = res.headers["set-cookie"];
    if (cookies) {
      const tokenCookie = cookies.find((c) => c.startsWith("token="));
      if (tokenCookie) {
        // Cookie should be cleared (empty value or expired)
        expect(
          tokenCookie.includes("token=;") ||
            tokenCookie.includes("Expires=Thu, 01 Jan 1970")
        ).toBe(true);
      }
    }
  });
});
