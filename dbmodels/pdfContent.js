const mongoose = require("mongoose");

// ── PdfContent Schema ───────────────────────────────────────────────────────
// Stores PDF text, chunks, and embeddings in a separate collection
// to avoid hitting MongoDB's 16MB document size limit on User documents.

const pdfContentSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    // Raw extracted text — dropped after chunking to save storage
    text: {
      type: String,
      default: "",
    },
    // Chunked text for semantic search
    chunks: [
      {
        text: { type: String, required: true },
        startIdx: { type: Number, required: true },
        endIdx: { type: Number, required: true },
      },
    ],
    // Base64-encoded numpy embeddings array (compressed)
    embeddings: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// TTL index: auto-delete PDF content for sessions inactive > 90 days
pdfContentSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 } // 90 days
);

const PdfContent = mongoose.model("PdfContent", pdfContentSchema);

// Ensure indexes are created
PdfContent.createIndexes()
  .then(() => {
    console.log("[DB] PdfContent indexes ensured");
  })
  .catch((err) => {
    console.error("[DB] Error creating PdfContent indexes:", err);
  });

module.exports = PdfContent;
