const axios = require("axios");
const userModel = require("../dbmodels/user");
const PdfContent = require("../dbmodels/pdfContent");

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:5001";
const MAX_SESSIONS_PER_USER = 20;

/**
 * Migrate a guest's temporary session to a permanent user account.
 *
 * Called during login/signup when req.session.guestSessionId exists.
 * - Chunks + embeds the raw text via Python /chunk-text
 * - Creates a PdfContent document
 * - Pushes the session (with interaction history) to the user's session array
 * - Cleans up the guest session data from express-session
 *
 * @param {Object} req - Express request (with session)
 * @param {Object} user - Mongoose user document
 * @returns {string|null} - Migrated sessionId, or null if nothing to migrate
 */
async function migrateGuestSession(req, user) {
  const sessionId = req.session.guestSessionId;
  if (!sessionId) return null;

  const guestData = req.session[sessionId];
  if (!guestData || !guestData.pdfData) {
    // Clean up stale reference
    delete req.session.guestSessionId;
    return null;
  }

  // Check session cap
  if (user.session && user.session.length >= MAX_SESSIONS_PER_USER) {
    console.warn(
      "[Migration] User at session cap, skipping guest migration"
    );
    delete req.session[sessionId];
    delete req.session.guestSessionId;
    return null;
  }

  try {
    console.log(`[Migration] Migrating guest session ${sessionId} to user ${user.email}`);

    // 1. Chunk + embed the raw text via Python
    const rawText = guestData.pdfData.text || "";
    let chunks = [];
    let encodedEmbeddings = "";

    if (rawText.trim()) {
      const pythonRes = await axios.post(
        `${PYTHON_API_URL}/chunk-text`,
        { text: rawText },
        { timeout: 60000 } // 60s timeout for large texts
      );

      if (pythonRes.data && pythonRes.data.status === "success") {
        chunks = pythonRes.data.chunks || [];
        encodedEmbeddings = pythonRes.data.embeddings || "";
        console.log(`[Migration] Chunked into ${chunks.length} chunks`);
      } else {
        console.warn("[Migration] Python /chunk-text returned non-success, storing raw text only");
      }
    }

    // 2. Create PdfContent document
    const pdfContentDoc = await PdfContent.create({
      sessionId,
      userId: user._id,
      text: rawText,
      chunks,
      embeddings: encodedEmbeddings,
    });

    // 3. Push session to user document with interaction history
    const metaInfo = guestData.pdfData.meta_info || {
      Title: "Untitled PDF",
      Author: "Unknown",
      Pages: 0,
    };

    await userModel.findByIdAndUpdate(user._id, {
      $push: {
        session: {
          sessionId,
          pdfContent: pdfContentDoc._id,
          pdfData: {
            meta_info: {
              Title: metaInfo.Title,
              Author: metaInfo.Author,
              Pages: metaInfo.Pages,
            },
          },
          interaction: guestData.interaction || [],
          lastInteraction: new Date(),
        },
      },
    });

    console.log(`[Migration] Successfully migrated session ${sessionId}`);

    // 4. Clean up guest session data
    delete req.session[sessionId];
    delete req.session.guestSessionId;

    return sessionId;
  } catch (err) {
    console.error("[Migration] Error migrating guest session:", err.message);
    // Don't block login on migration failure — just clean up
    delete req.session[sessionId];
    delete req.session.guestSessionId;
    return null;
  }
}

module.exports = { migrateGuestSession };
