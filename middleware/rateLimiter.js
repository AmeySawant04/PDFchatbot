const rateLimit = require("express-rate-limit");

/**
 * Rate limiter for authentication routes (login/signup).
 * Prevents brute-force attacks.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 attempts per window
  message: { error: "Too many attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for AI query routes (/ask).
 * Prevents API abuse and controls cost.
 */
const askLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 15, // max 15 questions per minute
  message: {
    answer: "Too many requests. Please wait a moment before asking again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for file uploads.
 * Prevents storage abuse.
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 uploads per 15 minutes
  message: { error: "Too many uploads. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 */
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, askLimiter, uploadLimiter, generalLimiter };
