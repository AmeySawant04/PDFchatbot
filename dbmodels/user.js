const mongoose = require("mongoose");

// ── Connect to MongoDB ──────────────────────────────────────────────────────
const mongoUri =
  process.env.MONGODB_URI || "mongodb://localhost:27017/PDFchatbot";

mongoose
  .connect(mongoUri)
  .then(() => console.log("[DB] Connected to MongoDB"))
  .catch((err) => {
    console.error("[DB] MongoDB connection error:", err.message);
    process.exit(1);
  });

// Handle connection events
mongoose.connection.on("error", (err) => {
  console.error("[DB] MongoDB error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("[DB] MongoDB disconnected. Attempting reconnect...");
});

// ── Session Schema ──────────────────────────────────────────────────────────

const sessionSchema = mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
    },
    // Reference to PdfContent collection (stores text, chunks, embeddings)
    pdfContent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PdfContent",
    },
    pdfData: {
      // text is kept optional for backward compat during migration
      // New sessions will NOT store text here — it goes to PdfContent
      text: {
        type: String,
      },
      meta_info: {
        Title: {
          type: String,
          required: true,
        },
        Author: {
          type: String,
          required: true,
        },
        Pages: {
          type: Number,
          required: true,
        },
      },
    },
    interaction: [
      {
        question: {
          type: String,
          required: true,
        },
        response: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastInteraction: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// ── User Schema ─────────────────────────────────────────────────────────────

const userSchema = mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    session: [sessionSchema],
  },
  { timestamps: true }
);

// Only index sessionId, email is already indexed due to unique constraint
userSchema.index({ "session.sessionId": 1 });

const User = mongoose.model("user", userSchema);

// Ensure indexes are created
User.createIndexes()
  .then(() => {
    console.log("[DB] Database indexes ensured");
  })
  .catch((err) => {
    console.error("[DB] Error creating indexes:", err);
  });

module.exports = User;
