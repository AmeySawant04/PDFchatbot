const jwt = require("jsonwebtoken");
const userModel = require("../dbmodels/user");

/**
 * Middleware: Verify JWT token from cookies and attach user to request.
 * Does NOT block the request if no token is present — just sets req.user = null.
 */
function attachUser(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    req.user = null;
    req.userEmail = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    // Invalid/expired token — clear it and continue as guest
    res.clearCookie("token", { httpOnly: true, sameSite: "Strict" });
    req.user = null;
    req.userEmail = null;
    next();
  }
}

/**
 * Middleware: Require authentication.
 * Redirects to login page if not authenticated.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect("/login/0");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    res.clearCookie("token", { httpOnly: true, sameSite: "Strict" });
    return res.redirect("/login/0");
  }
}

/**
 * Helper: Fetch user data and prepare clean user object for templates.
 * Returns null if user not found.
 */
async function getUserData(email) {
  const user = await userModel.findOne({ email }).lean();
  if (!user) return null;

  // Ensure session is an array and filter invalid entries
  const sessions = (user.session || [])
    .filter((s) => s && s.pdfData && s.pdfData.meta_info)
    .sort((a, b) => {
      const timeA = a.lastInteraction
        ? new Date(a.lastInteraction)
        : new Date(0);
      const timeB = b.lastInteraction
        ? new Date(b.lastInteraction)
        : new Date(0);
      return timeB - timeA;
    });

  return {
    fullName: user.fullName,
    email: user.email,
    session: sessions,
  };
}

/**
 * Helper: Generate JWT token and set cookie.
 */
function setAuthCookie(res, email) {
  const isProduction = process.env.NODE_ENV === "production";
  const token = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: isProduction,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return token;
}

module.exports = { attachUser, requireAuth, getUserData, setAuthCookie };
