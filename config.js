/**
 * config.js — BYOK Key Resolver
 *
 * Resolution order:
 *   1. User-provided keys (stored in their Firestore doc)
 *   2. Host .env defaults
 *   3. FAIL HARD — no silent fallback to empty strings
 *
 * Constitutional compliance: PRIVACY_ABSOLUTE
 *   - User keys never logged
 *   - User keys never cached outside Firestore
 */

require("dotenv").config();

const REQUIRED_KEYS = {
  groq: ["GROQ_API_KEY"],
  firebase: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"],
  resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  vapid: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
};

/**
 * Resolve a config key.
 * @param {string} key — env variable name
 * @param {object|null} userConfig — user-provided overrides from Firestore
 * @returns {string} resolved value
 * @throws {Error} if neither user nor env provides the key
 */
function resolveKey(key, userConfig = null) {
  // 1. User-provided key takes priority
  if (userConfig && userConfig[key] && userConfig[key].trim() !== "") {
    return userConfig[key].trim();
  }

  // 2. Host .env fallback
  if (process.env[key] && process.env[key].trim() !== "") {
    return process.env[key].trim();
  }

  // 3. Hard fail — no silent empty strings
  throw new Error(
    `[CONFIG FATAL] Key "${key}" not found. ` +
    `Provide it via BYOK (user settings) or .env file.`
  );
}

/**
 * Resolve all keys for a service group.
 * @param {string} group — one of: groq, firebase, resend, vapid
 * @param {object|null} userConfig — user-provided overrides
 * @returns {object} map of key→value
 */
function resolveGroup(group, userConfig = null) {
  const keys = REQUIRED_KEYS[group];
  if (!keys) {
    throw new Error(`[CONFIG FATAL] Unknown service group: "${group}"`);
  }

  const resolved = {};
  const missing = [];

  for (const key of keys) {
    try {
      resolved[key] = resolveKey(key, userConfig);
    } catch {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[CONFIG FATAL] Missing keys for "${group}": ${missing.join(", ")}. ` +
      `Provide via BYOK or .env.`
    );
  }

  return resolved;
}

/**
 * Get Groq config for a specific user.
 * @param {object|null} userConfig
 * @returns {{ apiKey: string, triageModel: string, translateModel: string }}
 */
function getGroqConfig(userConfig = null) {
  const keys = resolveGroup("groq", userConfig);
  return {
    apiKey: keys.GROQ_API_KEY,
    triageModel: process.env.GROQ_MODEL_TRIAGE || "llama3-8b-8192",
    translateModel: process.env.GROQ_MODEL_TRANSLATE || "llama3-70b-8192",
  };
}

/**
 * Get Firebase config.
 * @param {object|null} userConfig
 * @returns {{ projectId: string, clientEmail: string, privateKey: string }}
 */
function getFirebaseConfig(userConfig = null) {
  const keys = resolveGroup("firebase", userConfig);
  return {
    projectId: keys.FIREBASE_PROJECT_ID,
    clientEmail: keys.FIREBASE_CLIENT_EMAIL,
    privateKey: keys.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

/**
 * Get Resend (email) config.
 * @param {object|null} userConfig
 * @returns {{ apiKey: string, fromEmail: string }}
 */
function getResendConfig(userConfig = null) {
  const keys = resolveGroup("resend", userConfig);
  return {
    apiKey: keys.RESEND_API_KEY,
    fromEmail: keys.RESEND_FROM_EMAIL,
  };
}

/**
 * Get VAPID (web push) config.
 * @returns {{ publicKey: string, privateKey: string, subject: string }}
 */
function getVapidConfig() {
  const keys = resolveGroup("vapid");
  return {
    publicKey: keys.VAPID_PUBLIC_KEY,
    privateKey: keys.VAPID_PRIVATE_KEY,
    subject: keys.VAPID_SUBJECT,
  };
}

/**
 * Validate that minimum viable config exists to boot the system.
 * Called at startup.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBootConfig() {
  const errors = [];

  try { resolveGroup("firebase"); } catch (e) { errors.push(e.message); }
  try { resolveGroup("groq"); } catch (e) { errors.push(e.message); }

  // Resend and VAPID are optional at boot (WUPHF layer)
  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  resolveKey,
  resolveGroup,
  getGroqConfig,
  getFirebaseConfig,
  getResendConfig,
  getVapidConfig,
  validateBootConfig,
};
