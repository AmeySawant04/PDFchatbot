/**
 * Chat Integration Tests
 *
 * Full-flow tests: signup → upload PDF → ask question → verify response.
 * Also tests upload validation and session management.
 *
 * Note: The Python server is NOT running during tests.
 * We mock axios calls to the Python server.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { buildApp, createTestUser, generateAuthToken } = require("../helpers");

// Mock axios to intercept calls to the Python server
jest.mock("axios");
const axios = require("axios");

let app;
let userModel;
let PdfContent;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  userModel = require("../../dbmodels/user");
  PdfContent = require("../../dbmodels/pdfContent");
  app = buildApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

afterEach(async () => {
  await userModel.deleteMany({});
  await PdfContent.deleteMany({});
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Upload Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/upload", () => {
  let token;
  let testPdfPath;

  beforeEach(async () => {
    const testData = await createTestUser(userModel);
    token = testData.token;

    // Create a minimal valid PDF file for testing
    testPdfPath = path.join(__dirname, "..", "..", "uploads", "test-upload.pdf");
    const minimalPdf =
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF";
    fs.writeFileSync(testPdfPath, minimalPdf);
  });

  afterEach(() => {
    // Cleanup test PDF if it still exists
    if (testPdfPath && fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
  });

  it("should upload a PDF and return session info", async () => {
    // Mock Python server response for PDF processing
    axios.post.mockResolvedValueOnce({
      data: {
        status: "success",
        pdf_data: {
          text: "Sample PDF content for testing.",
          meta_info: { Title: "Test PDF", Author: "Tester", Pages: 3 },
          chunks: [
            { text: "Sample PDF content", startIdx: 0, endIdx: 18 },
            { text: "for testing.", startIdx: 15, endIdx: 30 },
          ],
          embeddings: "base64encodedstring==",
        },
      },
    });

    const res = await request(app)
      .post("/api/v1/upload")
      .set("Cookie", `token=${token}`)
      .attach("pdf", testPdfPath)
      .expect(200);

    expect(res.body.message).toContain("processed");
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.title).toBe("Test PDF");
    expect(res.body.pages).toBe(3);

    // Verify PdfContent was created in separate collection
    const pdfContent = await PdfContent.findOne({
      sessionId: res.body.sessionId,
    });
    expect(pdfContent).not.toBeNull();
    expect(pdfContent.chunks).toHaveLength(2);
    expect(pdfContent.embeddings).toBe("base64encodedstring==");
  });

  it("should reject non-PDF files", async () => {
    const textPath = path.join(
      __dirname,
      "..",
      "..",
      "uploads",
      "test-upload.txt"
    );
    fs.writeFileSync(textPath, "Not a PDF file");

    try {
      const res = await request(app)
        .post("/api/v1/upload")
        .set("Cookie", `token=${token}`)
        .attach("pdf", textPath);

      // If we get a response (no ECONNRESET), it should be 400
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("PDF");
    } catch (err) {
      // Express 5 may close the connection abruptly on multer file-filter
      // rejection, causing ECONNRESET — this is still a valid rejection
      expect(err.message).toMatch(/ECONNRESET|socket hang up/i);
    }

    // Cleanup
    if (fs.existsSync(textPath)) {
      fs.unlinkSync(textPath);
    }
  });

  it("should return 400 when no file is provided", async () => {
    const res = await request(app)
      .post("/api/v1/upload")
      .set("Cookie", `token=${token}`)
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ask Question Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/ask/:sessionId", () => {
  let token;
  let sessionId;
  let email;

  beforeEach(async () => {
    const testData = await createTestUser(userModel);
    token = testData.token;
    email = testData.user.email;
    sessionId = "test-session-" + Date.now();

    // Create a PdfContent document
    const pdfContent = await PdfContent.create({
      sessionId,
      userId: testData.user._id,
      text: "Test PDF content",
      chunks: [{ text: "Test PDF content", startIdx: 0, endIdx: 16 }],
      embeddings: "dGVzdGVtYmVkZGluZw==",
    });

    // Add session to user with pdfContent reference
    await userModel.findOneAndUpdate(
      { email },
      {
        $push: {
          session: {
            sessionId,
            pdfContent: pdfContent._id,
            pdfData: {
              meta_info: { Title: "Test PDF", Author: "Tester", Pages: 1 },
            },
            interaction: [],
            lastInteraction: new Date(),
          },
        },
      }
    );
  });

  it("should ask a question and get an answer", async () => {
    // Mock Python server response
    axios.post.mockResolvedValueOnce({
      data: { answer: "This is the AI response to your question." },
    });

    const res = await request(app)
      .post(`/api/v1/ask/${sessionId}`)
      .set("Cookie", `token=${token}`)
      .send({
        question: "What is this document about?",
        chatHistory: [],
        tokenLimits: { aiResponse: 2048 },
      })
      .expect(200);

    expect(res.body.answer).toBe(
      "This is the AI response to your question."
    );

    // Verify interaction was saved
    const user = await userModel.findOne({ email });
    const session = user.session.find((s) => s.sessionId === sessionId);
    expect(session.interaction).toHaveLength(1);
    expect(session.interaction[0].question).toBe(
      "What is this document about?"
    );
  });

  it("should return 404 for non-existent session", async () => {
    const res = await request(app)
      .post("/api/v1/ask/non-existent-session")
      .set("Cookie", `token=${token}`)
      .send({
        question: "Hello?",
        chatHistory: [],
      })
      .expect(404);

    expect(res.body.answer).toContain("not found");
  });

  it("should clamp oversized chat history on server side", async () => {
    // Create 30 messages (over the 20 limit)
    const oversizedHistory = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    // Mock Python server — we just check it gets called (history clamped)
    axios.post.mockResolvedValueOnce({
      data: { answer: "Clamped response." },
    });

    const res = await request(app)
      .post(`/api/v1/ask/${sessionId}`)
      .set("Cookie", `token=${token}`)
      .send({
        question: "After many messages",
        chatHistory: oversizedHistory,
        tokenLimits: { aiResponse: 2048 },
      })
      .expect(200);

    expect(res.body.answer).toBe("Clamped response.");

    // Verify the Python payload had clamped history
    expect(axios.post).toHaveBeenCalled();
    const pythonPayloadCall = axios.post.mock.calls[0];
    expect(pythonPayloadCall).toBeDefined();
    const sentHistory = pythonPayloadCall[1].chatHistory;
    // The formatted history is a joined string of "Human: ...\nAssistant: ..." lines
    // After clamping to 20 messages, we should see at most 20 non-empty lines
    const lineCount = sentHistory.split("\n").filter((l) => l.trim()).length;
    expect(lineCount).toBeLessThanOrEqual(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Session Management Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Session Management", () => {
  let token;
  let sessionId;
  let email;

  beforeEach(async () => {
    const testData = await createTestUser(userModel);
    token = testData.token;
    email = testData.user.email;
    sessionId = "manage-session-" + Date.now();

    // Create PdfContent
    const pdfContent = await PdfContent.create({
      sessionId,
      userId: testData.user._id,
      text: "Manageable content",
      chunks: [],
      embeddings: "",
    });

    // Add session
    await userModel.findOneAndUpdate(
      { email },
      {
        $push: {
          session: {
            sessionId,
            pdfContent: pdfContent._id,
            pdfData: {
              meta_info: { Title: "Rename Me", Author: "Author", Pages: 1 },
            },
            interaction: [],
          },
        },
      }
    );
  });

  it("should rename a session", async () => {
    const res = await request(app)
      .post(`/api/v1/rename/${sessionId}`)
      .set("Cookie", `token=${token}`)
      .send({ newTitle: "New Title" })
      .expect(200);

    expect(res.body.message).toContain("Renamed");

    // Verify in DB
    const user = await userModel.findOne({ email });
    const session = user.session.find((s) => s.sessionId === sessionId);
    expect(session.pdfData.meta_info.Title).toBe("New Title");
  });

  it("should reject rename with empty title", async () => {
    await request(app)
      .post(`/api/v1/rename/${sessionId}`)
      .set("Cookie", `token=${token}`)
      .send({ newTitle: "" })
      .expect(400);
  });

  it("should delete a session and its PdfContent", async () => {
    const res = await request(app)
      .delete(`/api/v1/session/${sessionId}`)
      .set("Cookie", `token=${token}`)
      .expect(200);

    expect(res.body.message).toContain("deleted");

    // Verify removed from user
    const user = await userModel.findOne({ email });
    const session = user.session.find((s) => s.sessionId === sessionId);
    expect(session).toBeUndefined();

    // Verify PdfContent also deleted
    const pdfContent = await PdfContent.findOne({ sessionId });
    expect(pdfContent).toBeNull();
  });

  it("should require auth for rename", async () => {
    await request(app)
      .post(`/api/v1/rename/${sessionId}`)
      .send({ newTitle: "Unauthorized" })
      .expect(401);
  });

  it("should require auth for delete", async () => {
    await request(app)
      .delete(`/api/v1/session/${sessionId}`)
      .expect(401);
  });
});
