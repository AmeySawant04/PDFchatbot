/**
 * Validator Tests
 *
 * Tests for input validation middleware (signup, login, ask question).
 * These test the validation rules in isolation by running them
 * through a minimal Express app.
 */

const request = require("supertest");
const express = require("express");
const {
  signupValidation,
  loginValidation,
  askValidation,
  renameValidation,
  handleValidationErrors,
} = require("../../middleware/validators");

/**
 * Build a tiny app that runs a set of validators and returns the results.
 */
function validatorApp(validators) {
  const app = express();
  app.use(express.json());
  app.post("/test", validators, handleValidationErrors, (req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// Signup Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Signup Validation", () => {
  const app = validatorApp(signupValidation);

  it("should pass with valid data", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        fullName: "John Doe",
        email: "john@example.com",
        password: "securepass",
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it("should reject short fullName", async () => {
    await request(app)
      .post("/test")
      .send({
        fullName: "J",
        email: "j@example.com",
        password: "securepass",
      })
      .expect(400);
  });

  it("should reject empty fullName", async () => {
    await request(app)
      .post("/test")
      .send({
        fullName: "",
        email: "j@example.com",
        password: "securepass",
      })
      .expect(400);
  });

  it("should reject invalid email", async () => {
    await request(app)
      .post("/test")
      .send({
        fullName: "John Doe",
        email: "not-valid",
        password: "securepass",
      })
      .expect(400);
  });

  it("should reject empty email", async () => {
    await request(app)
      .post("/test")
      .send({
        fullName: "John Doe",
        email: "",
        password: "securepass",
      })
      .expect(400);
  });

  it("should reject password shorter than 6 chars", async () => {
    await request(app)
      .post("/test")
      .send({
        fullName: "John Doe",
        email: "john@example.com",
        password: "12345",
      })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Login Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Login Validation", () => {
  const app = validatorApp(loginValidation);

  it("should pass with valid credentials", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        email: "user@example.com",
        password: "anypass",
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it("should reject invalid email format", async () => {
    await request(app)
      .post("/test")
      .send({
        email: "invalid-email",
        password: "anypass",
      })
      .expect(400);
  });

  it("should reject empty password", async () => {
    await request(app)
      .post("/test")
      .send({
        email: "user@example.com",
        password: "",
      })
      .expect(400);
  });

  it("should reject missing email", async () => {
    await request(app)
      .post("/test")
      .send({ password: "anypass" })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ask Question Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Ask Validation", () => {
  const app = validatorApp(askValidation);

  it("should pass with a valid question", async () => {
    const res = await request(app)
      .post("/test")
      .send({ question: "What is this document about?" })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it("should reject empty question", async () => {
    await request(app)
      .post("/test")
      .send({ question: "" })
      .expect(400);
  });

  it("should reject question longer than 5000 chars", async () => {
    await request(app)
      .post("/test")
      .send({ question: "x".repeat(5001) })
      .expect(400);
  });

  it("should pass with question at exactly 5000 chars", async () => {
    const res = await request(app)
      .post("/test")
      .send({ question: "x".repeat(5000) })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rename Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Rename Validation", () => {
  const app = validatorApp(renameValidation);

  it("should pass with a valid title", async () => {
    const res = await request(app)
      .post("/test")
      .send({ newTitle: "My PDF Document" })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it("should reject empty title", async () => {
    await request(app)
      .post("/test")
      .send({ newTitle: "" })
      .expect(400);
  });

  it("should reject title longer than 200 chars", async () => {
    await request(app)
      .post("/test")
      .send({ newTitle: "x".repeat(201) })
      .expect(400);
  });
});
