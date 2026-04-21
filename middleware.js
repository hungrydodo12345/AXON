/**
 * middleware.js — Security Layer
 *
 * Fixes:
 *   - Auth: token-based verification on all endpoints
 *   - CORS: restricted to allowed origins only
 *   - Rate limiting: per-IP and per-endpoint limits
 *
 * Constitutional compliance: PRIVACY_ABSOLUTE
 *   - No user data in logs
 *   - Auth tokens validated server-side only
 */

const crypto = require("crypto");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

/**
 * Generate a user-specific auth token.
 * Token = HMAC(userId, AUTH_SECRET). Stateless, no DB lookup.
 * User receives this after onboarding via PWA.
 *
 * @param {string} userId — phone number
 * @returns {string} hex token
 */
function generateToken(userId) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("[AUTH FATAL] AUTH_SECRET must be at least 32 characters.");
  }
  return crypto.createHmac("sha256", secret).update(userId).digest("hex");
}

/**
 * Verify a request's auth token.
 * Expects header: Authorization: Bearer <token>
 * Token must match HMAC(userId from URL, AUTH_SECRET).
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header." });
  }

  const token = authHeader.split(" ")[1];
  const userId = req.params.userId;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId parameter." });
  }

  const expected = generateToken(userId);
  const isValid = crypto.timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(expected, "hex")
  );

  if (!isValid) {
    return res.status(403).json({ error: "Invalid auth token." });
  }

  next();
}

// ============================================================
// CORS CONFIGURATION
// ============================================================

function getCorsMiddleware() {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // If no origins configured, allow none (secure default)
  if (allowedOrigins.length === 0) {
    console.warn("[SECURITY] No ALLOWED_ORIGINS set. CORS will reject all cross-origin requests.");
  }

  return cors({
    origin: (origin, callback) => {
      // Allow server-to-server (no origin header)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS: Origin ${origin} not allowed.`));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * General API rate limiter.
 * Default: 100 requests per 15 minutes per IP.
 */
function getGeneralLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });
}

/**
 * Gargoyle-specific rate limiter.
 * Stricter: 5 requests per 5 minutes per IP.
 * Prevents spam while allowing genuine emergencies.
 */
function getGargoyleLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.GARGOYLE_COOLDOWN_SECONDS || "300", 10) * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Safety alert already sent. Cooldown active." },
  });
}

/**
 * SSE rate limiter.
 * Looser: 10 connections per 5 minutes per IP.
 */
function getSseLimiter() {
  return rateLimit({
    windowMs: 300000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many SSE connections." },
  });
}

// ============================================================
// APPLY ALL MIDDLEWARE
// ============================================================

/**
 * Apply all security middleware to an Express app.
 * @param {import('express').Express} app
 */
function applySecurityMiddleware(app) {
  // Helmet — security headers
  app.use(helmet({
    contentSecurityPolicy: false, // PWA needs inline scripts
  }));

  // CORS — restricted origins
  app.use(getCorsMiddleware());

  // General rate limiting
  app.use(getGeneralLimiter());
}

module.exports = {
  generateToken,
  authMiddleware,
  getCorsMiddleware,
  getGeneralLimiter,
  getGargoyleLimiter,
  getSseLimiter,
  applySecurityMiddleware,
};
