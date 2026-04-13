const { body, validationResult } = require("express-validator");

/**
 * Validation rules for user signup.
 */
const signupValidation = [
  body("fullName")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Full name must be between 2 and 100 characters")
    .escape(),
  body("email")
    .isEmail()
    .withMessage("Please enter a valid email address")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

/**
 * Validation rules for user login.
 */
const loginValidation = [
  body("email")
    .isEmail()
    .withMessage("Please enter a valid email address")
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
];

/**
 * Validation rules for ask question.
 */
const askValidation = [
  body("question")
    .trim()
    .notEmpty()
    .withMessage("Question cannot be empty")
    .isLength({ max: 5000 })
    .withMessage("Question is too long (max 5000 characters)"),
];

/**
 * Validation rules for rename session.
 */
const renameValidation = [
  body("newTitle")
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 200 })
    .withMessage("Title is too long (max 200 characters)")
    .escape(),
];

/**
 * Middleware: Check validation results and return errors if any.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // For API routes, return JSON
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(400).json({ errors: errors.array() });
    }
    // For form submissions, redirect back with error
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

module.exports = {
  signupValidation,
  loginValidation,
  askValidation,
  renameValidation,
  handleValidationErrors,
};
