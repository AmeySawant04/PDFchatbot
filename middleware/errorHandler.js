const path = require("path");

/**
 * 404 Handler — must be placed after all route definitions.
 */
function notFoundHandler(req, res, next) {
  res.status(404);

  // For JSON API requests
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.json({ error: "Not Found" });
  }

  // For regular page requests
  res.render("error", {
    status: 404,
    message: "Page Not Found",
    description: "The page you're looking for doesn't exist.",
  });
}

/**
 * Global Error Handler — catches all unhandled errors.
 * Must have 4 parameters (err, req, res, next) to be recognized by Express.
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.status || 500;
  const isProduction = process.env.NODE_ENV === "production";

  // Log error details (full stack in development only)
  console.error(
    `[ERROR] ${req.method} ${req.originalUrl}:`,
    isProduction ? err.message : err.stack
  );

  // For JSON API requests
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.status(statusCode).json({
      error: isProduction ? "Internal Server Error" : err.message,
    });
  }

  // For regular page requests
  res.status(statusCode).render("error", {
    status: statusCode,
    message: statusCode === 500 ? "Internal Server Error" : err.message,
    description: isProduction
      ? "Something went wrong. Please try again."
      : err.stack,
  });
}

module.exports = { notFoundHandler, errorHandler };
