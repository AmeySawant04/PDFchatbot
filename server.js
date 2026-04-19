// ── Load environment variables FIRST ────────────────────────────────────────
require("dotenv").config();

// ── Validate required env vars ──────────────────────────────────────────────
const requiredEnvVars = ["JWT_SECRET", "SESSION_SECRET"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`[FATAL] Missing required environment variable: ${envVar}`);
    console.error(`        Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
}

// ── Dependencies ────────────────────────────────────────────────────────────
const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");

// ── Route imports ───────────────────────────────────────────────────────────
const {
  pageRouter: authPageRoutes,
  apiRouter: authApiRoutes,
} = require("./routes/auth");
const {
  pageRouter: chatPageRoutes,
  apiRouter: chatApiRoutes,
} = require("./routes/chat");
const legacyRedirects = require("./routes/legacy");

// ── Middleware imports ──────────────────────────────────────────────────────
const { generalLimiter } = require("./middleware/rateLimiter");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

// ── Database migration utility ──────────────────────────────────────────────
const userModel = require("./dbmodels/user");
const PdfContent = require("./dbmodels/pdfContent");

async function migrateSessions() {
  try {
    console.log("[Migration] Starting session migration...");
    const users = await userModel.find({});
    console.log(`[Migration] Found ${users.length} users`);

    for (const user of users) {
      let needsUpdate = false;

      // Ensure session is an array
      if (!Array.isArray(user.session)) {
        user.session = [];
        needsUpdate = true;
      }

      // Filter out any invalid sessions and add sessionId where missing
      // Sessions are valid if they have pdfData.meta_info OR pdfContent ref
      user.session = user.session
        .filter((session) => {
          const hasMetaInfo =
            session && session.pdfData && session.pdfData.meta_info;
          const hasPdfContentRef = session && session.pdfContent;
          return hasMetaInfo || hasPdfContentRef;
        })
        .map((session) => {
          if (!session.sessionId) {
            needsUpdate = true;
            const sessionId =
              Date.now().toString(36) + Math.random().toString(36).substring(2);
            return {
              ...session.toObject(),
              sessionId,
              lastInteraction: session.lastInteraction || new Date(),
            };
          }
          return session;
        });

      if (needsUpdate) {
        console.log(
          `[Migration] Updating user ${user.email} with ${user.session.length} sessions`,
        );
        await userModel.updateOne(
          { _id: user._id },
          { $set: { session: user.session } },
        );
      }
    }
    console.log("[Migration] Session migration completed successfully");
  } catch (err) {
    console.error("[Migration] Error migrating sessions:", err);
  }
}

// ── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;

// ── Static Assets (served FIRST — no middleware interference on CSS/JS/images) ──
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: isProduction ? "7d" : 0,
    etag: true,
  }),
);

// ── Security Middleware ─────────────────────────────────────────────────────
app.use(
  helmet({
    // In dev, send max-age=0 to actively clear any cached HSTS policy from browser.
    // Setting false would just stop sending the header without clearing the cache.
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : { maxAge: 0, includeSubDomains: false },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "cdn.jsdelivr.net",
          "cdnjs.cloudflare.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"], // Required for onclick handlers in templates
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "cdn.jsdelivr.net",
          "cdnjs.cloudflare.com",
        ],
        fontSrc: ["'self'", "cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

// ── CORS ────────────────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

// ── General Middleware ───────────────────────────────────────────────────────
app.use(compression()); // Gzip responses
app.use(morgan(isProduction ? "combined" : "dev")); // Request logging
app.use(express.json({ limit: "10mb" })); // JSON body parser with size limit
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(generalLimiter);

// ── Session ─────────────────────────────────────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // Changed: don't create sessions for every visitor
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours for guest sessions
    },
  }),
);

// ── View Engine ─────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
// Page routes (serve HTML) — no versioning needed
app.use("/", authPageRoutes); // GET /login, GET /login/:status
app.use("/", chatPageRoutes); // GET /, GET /chat, GET /chat/:sessionId

// Versioned API routes
app.use("/api/v1", chatApiRoutes); // Rate-limit API only (not HTML/static assets)
app.use("/api/v1/auth", authApiRoutes); // POST /api/v1/auth/create-user, etc.

// Legacy backward-compat redirects (old routes → versioned routes via 308)
app.use("/", legacyRedirects);

// ── Error Handling ──────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Graceful Shutdown ───────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("[Server] HTTP server closed.");
    const mongoose = require("mongoose");
    mongoose.connection.close(false).then(() => {
      console.log("[Server] MongoDB connection closed.");
      process.exit(0);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

// ── Start Server ────────────────────────────────────────────────────────────
let server;

migrateSessions().then(() => {
  console.log("[Migration] Session migration completed");
  server = app.listen(PORT, () => {
    console.log(`[Server] PDF Chat running on http://localhost:${PORT}`);
    console.log(
      `[Server] Environment: ${process.env.NODE_ENV || "development"}`,
    );
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
});

// ── Handle uncaught errors ──────────────────────────────────────────────────
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
  process.exit(1);
});
