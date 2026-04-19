const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const { marked } = require("marked");
const jwt = require("jsonwebtoken");
const userModel = require("../dbmodels/user");
const PdfContent = require("../dbmodels/pdfContent");
const { attachUser, getUserData } = require("../middleware/auth");
const { askLimiter, uploadLimiter } = require("../middleware/rateLimiter");
const {
  askValidation,
  handleValidationErrors,
} = require("../middleware/validators");

// Configure marked options
marked.setOptions({
  headerIds: false,
  mangle: false,
});

// Configure multer with file size limits
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"), false);
    }
    cb(null, true);
  },
});

// Python server URL from env
const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:5001";

// Max active sessions per user (storage optimization)
const MAX_SESSIONS_PER_USER = 20;

// ═══════════════════════════════════════════════════════════════════════════
// PAGE ROUTES — mounted at "/" in server.js
// ═══════════════════════════════════════════════════════════════════════════

const pageRouter = express.Router();

// ── Root redirect ───────────────────────────────────────────────────────────

pageRouter.get("/", (req, res) => {
  res.redirect("/chat");
});

// ── Chat Page (no session) ──────────────────────────────────────────────────

pageRouter.get("/chat", attachUser, async (req, res) => {
  if (!req.userEmail) {
    return res.render("index", {
      user: null,
      sessionId: null,
      targetSession: null,
    });
  }

  try {
    const userData = await getUserData(req.userEmail);
    if (!userData) {
      return res.redirect("/login/0");
    }

    res.render("index", {
      user: userData,
      sessionId: null,
      targetSession: null,
    });
  } catch (e) {
    console.error("[Chat] Error loading chat page:", e.message);
    res.clearCookie("token", { httpOnly: true, sameSite: "Strict" });
    res.redirect("/login/0");
  }
});

// ── Chat Page (with session) ────────────────────────────────────────────────

pageRouter.get("/chat/:sessionId", attachUser, async (req, res) => {
  const sessionId = req.params.sessionId;

  if (req.userEmail) {
    try {
      const userData = await getUserData(req.userEmail);
      if (!userData) {
        return res.redirect("/login/0");
      }

      // Find the target session
      const targetSession = userData.session.find(
        (s) => s.sessionId === sessionId
      );
      if (!targetSession) {
        return res.status(404).render("error", {
          status: 404,
          message: "Session Not Found",
          description: "The chat session you're looking for doesn't exist.",
        });
      }

      // Format past interactions with markdown
      let pastInteractions = (targetSession.interaction || []).map(
        (interaction) => ({
          question: interaction.question,
          response: marked(interaction.response),
        })
      );

      res.render("index", {
        user: userData,
        sessionId: sessionId,
        targetSession: targetSession,
        pastInteractions: pastInteractions,
      });
    } catch (e) {
      console.error("[Chat] Error loading session:", e.message);
      res.clearCookie("token", { httpOnly: true, sameSite: "Strict" });
      res.redirect("/login/0");
    }
  } else {
    // Handle non-logged in user with temporary session
    if (req.session[sessionId]) {
      const tempSession = req.session[sessionId];
      res.render("index", {
        user: null,
        sessionId: sessionId,
        targetSession: tempSession,
        pastInteractions: (tempSession.interaction || []).map((interaction) => ({
          question: interaction.question,
          response: marked(interaction.response),
        })),
      });
    } else {
      res.redirect("/");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API ROUTES — mounted at "/api/v1" in server.js
// ═══════════════════════════════════════════════════════════════════════════

const apiRouter = express.Router();

// ── Ask Question (no target session — legacy) ───────────────────────────────

apiRouter.post(
  "/ask",
  askLimiter,
  askValidation,
  handleValidationErrors,
  async (req, res) => {
    const question = req.body.question;

    try {
      const pythonRes = await axios.post(`${PYTHON_API_URL}/ask`, {
        question,
      });

      if (pythonRes.data && pythonRes.data.answer) {
        return res.json({ answer: pythonRes.data.answer });
      } else {
        console.error("[Chat] Python server returned no answer:", pythonRes.data);
        return res.status(500).json({
          answer: "Sorry, no answer returned from the AI server.",
        });
      }
    } catch (error) {
      console.error("[Chat] Error in /ask route:", error.message);
      return res.status(500).json({ answer: "Sorry, there was an error." });
    }
  }
);

// ── Ask Question (with session) ─────────────────────────────────────────────

apiRouter.post(
  "/ask/:sessionId",
  attachUser,
  askLimiter,
  askValidation,
  handleValidationErrors,
  async (req, res) => {
    const { question, chatHistory, tokenLimits } = req.body;
    const sessionId = req.params.sessionId;

    // Server-side chat history clamping (max 20 messages = 10 Q&A pairs)
    const MAX_HISTORY_MESSAGES = 20;
    let clampedHistory = chatHistory || [];
    if (clampedHistory.length > MAX_HISTORY_MESSAGES) {
      console.warn(
        `[Chat] Client sent ${clampedHistory.length} history messages, clamping to ${MAX_HISTORY_MESSAGES}`
      );
      clampedHistory = clampedHistory.slice(-MAX_HISTORY_MESSAGES);
    }

    try {
      let tempSession;
      let pdfData;
      let email;
      let pdfContentDoc = null;

      if (req.userEmail) {
        // Handle logged-in user
        email = req.userEmail;
        const user = await userModel.findOne({ email });

        const targetSession = user.session.find(
          (s) => s.sessionId === sessionId
        );
        if (!targetSession) {
          return res.status(404).json({ answer: "Session not found." });
        }

        // Try to fetch from PdfContent collection first (new format)
        pdfContentDoc = await PdfContent.findOne({ sessionId });

        if (pdfContentDoc) {
          // New format: use chunks/embeddings from PdfContent
          pdfData = {
            meta_info: targetSession.pdfData.meta_info,
            text: pdfContentDoc.text || "",
            chunks: pdfContentDoc.chunks || [],
            embeddings: pdfContentDoc.embeddings || "",
          };
        } else {
          // Legacy format: text stored in user document
          pdfData = targetSession.pdfData;
        }
      } else {
        // Handle non-logged in user
        tempSession = req.session[sessionId];
        if (!tempSession) {
          return res.status(404).json({ answer: "Session not found." });
        }
        pdfData = tempSession.pdfData;
      }

      // Format chat history for the prompt
      const formattedHistory = clampedHistory
        .map(
          (msg) =>
            `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`
        )
        .join("\n");

      // Build payload for Python server
      const pythonPayload = {
        question,
        pdfData,
        chatHistory: formattedHistory,
        tokenLimits,
      };

      const pythonRes = await axios.post(
        `${PYTHON_API_URL}/ask-target`,
        pythonPayload
      );

      if (pythonRes.data && pythonRes.data.answer) {
        const timestamp = new Date();
        const newInteraction = {
          question,
          response: pythonRes.data.answer,
          timestamp: timestamp,
        };

        if (req.userEmail) {
          // Update database for logged-in user
          await userModel.updateOne(
            {
              email,
              "session.sessionId": sessionId,
            },
            {
              $push: { "session.$.interaction": newInteraction },
              $set: { "session.$.lastInteraction": timestamp },
            }
          );

          // Update PdfContent updatedAt to reset TTL
          if (pdfContentDoc) {
            await PdfContent.updateOne(
              { sessionId },
              { $set: { updatedAt: timestamp } }
            );
          }
        } else {
          // Update session for non-logged in user
          if (!tempSession.interaction) {
            tempSession.interaction = [];
          }
          tempSession.interaction.push(newInteraction);
        }

        return res.json({ answer: pythonRes.data.answer });
      } else {
        return res.status(500).json({
          answer: "Sorry, no answer returned from the AI server.",
        });
      }
    } catch (error) {
      console.error("[Chat] Error in /ask/:sessionId:", error.message);
      return res.status(500).json({ answer: "Sorry, there was an error." });
    }
  }
);

// ── Upload PDF ──────────────────────────────────────────────────────────────

apiRouter.post(
  "/upload",
  attachUser,
  uploadLimiter,
  (req, res, next) => {
    upload.single("pdf")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 10MB." });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file provided." });
    }

    const filePath = req.file.path;

    try {
      const pythonResponse = await axios.post(`${PYTHON_API_URL}/process`, {
        pdf_path: filePath,
      });

      // Clean up uploaded file
      fs.unlink(filePath, (err) => {
        if (err) console.error("[Upload] Error deleting temp file:", err.message);
      });

      const pdfData = pythonResponse.data.pdf_data;
      if (!pdfData) {
        return res.status(500).json({
          error: "No PDF data returned from processing server.",
        });
      }

      // Generate a unique sessionId
      const sessionId =
        Date.now().toString(36) + Math.random().toString(36).substring(2);

      if (req.userEmail) {
        // Enforce session cap
        const user = await userModel.findOne({ email: req.userEmail });
        if (user && user.session && user.session.length >= MAX_SESSIONS_PER_USER) {
          return res.status(400).json({
            error: `Maximum ${MAX_SESSIONS_PER_USER} active sessions allowed. Please delete an old session first.`,
          });
        }

        // 1. Create PdfContent document in separate collection
        const pdfContentDoc = await PdfContent.create({
          sessionId,
          userId: user._id,
          text: pdfData.text,
          chunks: pdfData.chunks || [],
          embeddings: pdfData.embeddings || "",
        });

        // 2. Add session to user doc with ObjectId reference (no text stored here)
        const updatedUser = await userModel.findOneAndUpdate(
          { email: req.userEmail },
          {
            $push: {
              session: {
                sessionId,
                pdfContent: pdfContentDoc._id,
                pdfData: {
                  meta_info: {
                    Title: pdfData.meta_info.Title,
                    Author: pdfData.meta_info.Author,
                    Pages: pdfData.meta_info.Pages,
                  },
                },
                interaction: [],
                lastInteraction: new Date(),
              },
            },
          },
          { new: true }
        );

        if (!updatedUser) {
          // Rollback PdfContent if user not found
          await PdfContent.deleteOne({ _id: pdfContentDoc._id });
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          message: "PDF processed and saved!",
          sessionId: sessionId,
          title: pdfData.meta_info.Title,
          pages: pdfData.meta_info.Pages,
        });
      } else {
        // For non-logged in users, store PDF data in express-session
        req.session[sessionId] = {
          pdfData: {
            text: pdfData.text,
            meta_info: {
              Title: pdfData.meta_info.Title,
              Author: pdfData.meta_info.Author,
              Pages: pdfData.meta_info.Pages,
            },
          },
          interaction: [],
        };

        res.json({
          message: "PDF processed successfully!",
          sessionId: sessionId,
          title: pdfData.meta_info.Title,
          pages: pdfData.meta_info.Pages,
        });
      }
    } catch (err) {
      // Clean up uploaded file on error
      fs.unlink(filePath, () => {});
      console.error("[Upload] Error processing PDF:", err.message);
      res.status(500).json({ error: "Error processing PDF. Please try again." });
    }
  }
);

// ── Rename Session ──────────────────────────────────────────────────────────

apiRouter.post(
  "/rename/:sessionId",
  attachUser,
  async (req, res) => {
    const sessionId = req.params.sessionId;
    const { newTitle } = req.body;

    if (!req.userEmail) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!newTitle || newTitle.trim().length === 0) {
      return res.status(400).json({ error: "Title cannot be empty" });
    }

    try {
      await userModel.updateOne(
        {
          email: req.userEmail,
          "session.sessionId": sessionId,
        },
        {
          $set: { "session.$.pdfData.meta_info.Title": newTitle.trim() },
        }
      );

      res.status(200).json({ message: "Renamed successfully" });
    } catch (e) {
      console.error("[Session] Error renaming:", e.message);
      res.status(500).json({ error: "Failed to rename session" });
    }
  }
);

// ── Delete Session ──────────────────────────────────────────────────────────

apiRouter.delete(
  "/session/:sessionId",
  attachUser,
  async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!req.userEmail) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      // Remove PdfContent document
      await PdfContent.deleteOne({ sessionId });

      // Remove session from user document
      await userModel.updateOne(
        { email: req.userEmail },
        { $pull: { session: { sessionId } } }
      );

      res.status(200).json({ message: "Session deleted successfully" });
    } catch (e) {
      console.error("[Session] Error deleting:", e.message);
      res.status(500).json({ error: "Failed to delete session" });
    }
  }
);

module.exports = { pageRouter, apiRouter };
