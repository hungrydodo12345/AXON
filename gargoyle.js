/**
 * gargoyle.js — Safety Layer (Gargoyle Protocol)
 *
 * Constitutional compliance: SAFETY_BYPASS (CRITICAL PATH)
 *   - Safety Word triggers HARD bypass of LLM
 *   - Executes BEFORE any processing
 *   - Independent of all other systems
 *
 * Alert channels:
 *   1. WhatsApp (via whatsapp-web.js client)
 *   2. Email (via Resend API)
 *   3. Web Push (via web-push)
 *
 * This module has ZERO dependencies on triage, translation, or constitution.
 * It operates as a standalone safety system.
 */

const { Resend } = require("resend");
const webPush = require("web-push");
const { getResendConfig, getVapidConfig } = require("./config");
const { logGargoyleEvent } = require("./firebaseSchema");

// ============================================================
// SAFETY WORD DETECTION
// ============================================================

/**
 * Check if a message contains the user's Safety Word.
 * This is a PLAIN STRING MATCH — no LLM, no NLP, no ambiguity.
 *
 * MUST be called BEFORE any other processing.
 *
 * @param {string} messageText — raw message text
 * @param {string} safetyWord — user's configured safety word
 * @returns {boolean}
 */
function detectSafetyWord(messageText, safetyWord) {
  if (!safetyWord || !messageText) return false;

  const normalized = messageText.toLowerCase().trim();
  const word = safetyWord.toLowerCase().trim();

  // Exact word boundary match to prevent false positives
  // e.g. "gargoyle" should match "gargoyle" and "GARGOYLE"
  // but not "gargoyles" unless it starts with the word
  const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
  return regex.test(normalized);
}

/**
 * Escape special regex characters in the safety word.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// GARGOYLE PROTOCOL EXECUTION
// ============================================================

/**
 * Execute the full Gargoyle Protocol.
 * Sends alerts to ALL configured channels simultaneously.
 *
 * @param {object} params
 * @param {string} params.userId — user's phone number
 * @param {object} params.userProfile — user's Firestore profile
 * @param {string} params.triggerType — "safety_word" | "panic_button" | "auto_detect"
 * @param {string} params.triggerSource — "whatsapp" | "pwa" | "api"
 * @param {string} params.messageContext — sanitized context (no full messages)
 * @param {object|null} params.location — { lat, lng } if available
 * @param {object|null} params.whatsappClient — whatsapp-web.js client instance
 * @returns {object} result — { success, alerts_sent, errors }
 */
async function executeGargoyleProtocol({
  userId,
  userProfile,
  triggerType,
  triggerSource,
  messageContext = "",
  location = null,
  whatsappClient = null,
}) {
  // ── COOLDOWN DEDUPLICATION ──
  // Prevent alert spam if safety word is sent repeatedly.
  // Cooldown period: configurable, default 5 minutes.
  const cooldownSeconds = parseInt(process.env.GARGOYLE_COOLDOWN_SECONDS || "300", 10);
  const lastGargoyle = userProfile.last_gargoyle_at;

  if (lastGargoyle) {
    const lastTime = lastGargoyle.toDate ? lastGargoyle.toDate() : new Date(lastGargoyle);
    const elapsed = (Date.now() - lastTime.getTime()) / 1000;

    if (elapsed < cooldownSeconds) {
      console.warn(
        `[GARGOYLE] Cooldown active for ${userId}. ${Math.round(cooldownSeconds - elapsed)}s remaining. Skipping duplicate.`
      );
      return {
        success: true,
        alerts_sent: { whatsapp: false, email: false, web_push: false },
        errors: [],
        cooldown: true,
        cooldown_remaining: Math.round(cooldownSeconds - elapsed),
      };
    }
  }

  // Update last_gargoyle_at timestamp
  try {
    const { getDb } = require("./firebaseSchema");
    const admin = require("firebase-admin");
    await getDb().collection("users").doc(userId).update({
      last_gargoyle_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (tsErr) {
    console.error("[GARGOYLE] Failed to update cooldown timestamp:", tsErr.message);
  }

  const safetyContacts = userProfile.safety_contacts || [];
  const careNote = userProfile.care_note || "This person has activated their safety alert. Please check on them.";

  if (safetyContacts.length === 0) {
    console.error("[GARGOYLE] No safety contacts configured for user:", userId);
  }

  const alertMessage = buildAlertMessage({
    careNote,
    triggerType,
    triggerSource,
    location,
    timestamp: new Date().toISOString(),
  });

  const results = {
    whatsapp: false,
    email: false,
    web_push: false,
  };
  const errors = [];

  // Fire ALL channels in parallel — do not let one failure block others
  const promises = [];

  // 1. WhatsApp alerts
  if (whatsappClient) {
    for (const contact of safetyContacts) {
      if (contact.phone) {
        promises.push(
          sendWhatsAppAlert(whatsappClient, contact.phone, alertMessage)
            .then(() => { results.whatsapp = true; })
            .catch((err) => { errors.push(`WhatsApp to ${contact.name}: ${err.message}`); })
        );
      }
    }
  }

  // 2. Email alerts
  for (const contact of safetyContacts) {
    if (contact.email) {
      promises.push(
        sendEmailAlert(contact.email, contact.name, alertMessage, userProfile.user_keys)
          .then(() => { results.email = true; })
          .catch((err) => { errors.push(`Email to ${contact.name}: ${err.message}`); })
      );
    }
  }

  // 3. Web Push alerts
  if (userProfile.push_subscriptions) {
    for (const sub of userProfile.push_subscriptions) {
      promises.push(
        sendWebPushAlert(sub, alertMessage)
          .then(() => { results.web_push = true; })
          .catch((err) => { errors.push(`WebPush: ${err.message}`); })
      );
    }
  }

  // Wait for all alerts to complete (or fail)
  await Promise.allSettled(promises);

  // Log the event (NEVER deleted)
  try {
    await logGargoyleEvent(userId, {
      trigger_type: triggerType,
      trigger_source: triggerSource,
      message_context: messageContext,
      alerts_sent: results,
      location,
      care_note: careNote,
      acknowledged: false,
    });
  } catch (logErr) {
    errors.push(`Logging: ${logErr.message}`);
  }

  return {
    success: results.whatsapp || results.email || results.web_push,
    alerts_sent: results,
    errors,
  };
}

// ============================================================
// ALERT MESSAGE BUILDER
// ============================================================

function buildAlertMessage({ careNote, triggerType, triggerSource, location, timestamp }) {
  let msg = `🚨 SAFETY ALERT 🚨\n\n`;
  msg += `${careNote}\n\n`;
  msg += `Triggered: ${triggerType.replace("_", " ")}\n`;
  msg += `Source: ${triggerSource}\n`;
  msg += `Time: ${timestamp}\n`;

  if (location && location.lat && location.lng) {
    msg += `\nLocation: https://maps.google.com/?q=${location.lat},${location.lng}\n`;
  }

  msg += `\nPlease reach out to them now.`;
  return msg;
}

// ============================================================
// CHANNEL SENDERS
// ============================================================

/**
 * Send WhatsApp alert via whatsapp-web.js client.
 */
async function sendWhatsAppAlert(client, phoneNumber, message) {
  // whatsapp-web.js uses format: countrycode + number + @c.us
  const chatId = phoneNumber.replace("+", "") + "@c.us";
  await client.sendMessage(chatId, message);
}

/**
 * Send email alert via Resend API.
 */
async function sendEmailAlert(toEmail, toName, message, userKeys = null) {
  const config = getResendConfig(userKeys);
  const resend = new Resend(config.apiKey);

  await resend.emails.send({
    from: config.fromEmail,
    to: toEmail,
    subject: "🚨 Safety Alert — Neuro-Librarian",
    text: message,
  });
}

/**
 * Send web push notification.
 */
async function sendWebPushAlert(subscription, message) {
  const vapid = getVapidConfig();

  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const payload = JSON.stringify({
    title: "🚨 Safety Alert",
    body: message.substring(0, 200),
    urgency: "high",
  });

  await webPush.sendNotification(subscription, payload);
}

// ============================================================
// GROUNDING PROMPTS
// ============================================================

/**
 * Get a grounding message for the user.
 * Used after Gargoyle triggers or when user requests grounding.
 *
 * @param {object} constitution — resolved constitution rules
 * @returns {string}
 */
function getGroundingPrompt(constitution) {
  const custom = constitution?.safety?.grounding_prompt;
  if (custom) {
    return custom.replace("[current time]", new Date().toLocaleTimeString());
  }

  return `You are safe. You are here. The time is ${new Date().toLocaleTimeString()}.`;
}

module.exports = {
  detectSafetyWord,
  executeGargoyleProtocol,
  getGroundingPrompt,
};
