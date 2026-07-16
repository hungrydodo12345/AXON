/**
 * config.js — BYOK Key Resolver
 *
 * Resolution order:
 *   1. User-provided keys (stored in their local profile — see localSchema.js)
 *   2. Host .env defaults
 *   3. Hardcoded trial key (Groq only — see TRIAL_KEYS below)
 *   4. FAIL HARD — no silent fallback to empty strings
 *
 * Constitutional compliance: PRIVACY_ABSOLUTE
 *   - User keys never logged
 *   - User keys never leave the local datastore
 */

require("dotenv").config();

const REQUIRED_KEYS = {
  groq: ["GROQ_API_KEY"],
  resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  vapid: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
};

// ============================================================
// TRIAL KEYS
//
// Hardcoded fallback keys for a zero-setup first run, so a
// non-technical user can download AXON and use it immediately
// without creating any accounts. Intended for the initial trial
// only — swap TRIAL_KEYS.GROQ_API_KEY for your own key before
// any real/production distribution.
// ============================================================
const TRIAL_KEYS = {
  GROQ_API_KEY: process.env.AXON_TRIAL_GROQ_API_KEY || "", // ← paste trial key here or set AXON_TRIAL_GROQ_API_KEY
};

/**
 * Resolve a config key.
 * @param {string} key — env variable name
 * @param {object|null} userConfig — user-provided overrides from the local profile
 * @returns {string} resolved value
 * @throws {Error} if neither user, env, nor trial default provides the key
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

  // 3. Hardcoded trial fallback (Groq only)
  if (TRIAL_KEYS[key] && TRIAL_KEYS[key].trim() !== "") {
    return TRIAL_KEYS[key].trim();
  }

  // 4. Hard fail — no silent empty strings
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
  getResendConfig,
  getVapidConfig,
  validateBootConfig,
};
