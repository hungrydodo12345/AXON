/**
 * librarian.js — AXON Bridge
 *
 * Message processing order (NON-NEGOTIABLE):
 *   0. DEDUPLICATION CHECK — skip already-processed messages
 *   1. SAFETY WORD CHECK — plain string match, no LLM
 *   2. If safety word → execute Gargoyle Protocol → STOP
 *   3. Load user profile + constitution
 *   4. Triage message into pile
 *   5. Extract calendar events
 *   6. Store processed message
 *   7. Emit to PWA via Express SSE
 *
 * Sources feeding this pipeline today:
 *   - Email (IMAP, live poll) — see connectors/emailImap.js
 *   - Manual import: email paste, WhatsApp chat-export paste — POST /api/import/*
 *
 * Security:
 *   - Auth: HMAC token verification on all endpoints
 *   - CORS: restricted to ALLOWED_ORIGINS only
 *   - Rate limiting: per-IP general + per-endpoint specific
 *
 * Constitutional compliance:
 *   - SAFETY_BYPASS: Safety word is FIRST meaningful check
 *   - PRIVACY_ABSOLUTE: all data stays in the local datastore
 *   - BYOK: keys resolved per-user
 */

const express = require("express");
const { validateBootConfig } = require("./config");
const {
  initFirebase,
  getDb,
  getProfile,
  saveMessage,
  upsertProfile,
  upsertContact,
  getContact,
  getContacts,
} = require("./localSchema");
const { detectSafetyWord, executeGargoyleProtocol, getGroundingPrompt } = require("./gargoyle");
const { resolveConstitution } = require("./constitutionEngine");
const { triageMessage } = require("./triage");
const { extractCalendarEvents, startWuphfScheduler } = require("./wuphf");
const { analyzeMessage } = require("./sarcasmEngine");
const { translateMessage } = require("./translator");
const { generateTrinity } = require("./responseGenerator");
const { processMessageIntoMemory } = require("./memoryEngine");
const { trackWordFrequency, proposeGraduation } = require("./growthTracker");
const { startEmailImapConnector } = require("./connectors/emailImap");
const { parseWhatsAppExport } = require("./connectors/whatsappImport");
const { startGmailConnector } = require("./connectors/gmailApi");
const { getUpcomingEvents } = require("./connectors/googleCalendar");
const {
  applySecurityMiddleware,
  authMiddleware,
  getGargoyleLimiter,
  getSseLimiter,
  generateToken,
} = require("./bridgeSecurity");

// ============================================================
// BOOT VALIDATION
// ============================================================

const bootCheck = validateBootConfig();
if (!bootCheck.valid) {
  console.error("╔══════════════════════════════════════════╗");
  console.error("║  AXON — BOOT FAILED                       ║");
  console.error("╠══════════════════════════════════════════╣");
  for (const err of bootCheck.errors) {
    console.error(`║  ${err}`);
  }
  console.error("╚══════════════════════════════════════════╝");
  process.exit(1);
}

// ============================================================
// INITIALIZE SERVICES
// ============================================================

const db = initFirebase();

const app = express();
const PORT = process.env.PORT || 3000;
const sseClients = new Map();
let emailConnectorStatus = "not_configured";
let gmailConnectorStatus = "not_configured";

// Apply security middleware (helmet, CORS, rate limit)
applySecurityMiddleware(app);
app.use(express.json({ limit: "5mb" })); // chat exports can be sizeable

// ============================================================
// MESSAGE DEDUPLICATION (Fix #15)
// ============================================================

const processedMessages = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  return false;
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
  }
}, 5 * 60 * 1000);

// ============================================================
// ROUTES
// ============================================================

// Health check — no auth required
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    email_connector: emailConnectorStatus,
    gmail_connector: gmailConnectorStatus,
    uptime: process.uptime(),
  });
});

// SSE stream — auth + rate limited + heartbeat (Fix #1, #3, #11)
app.get("/events/:userId", getSseLimiter(), authMiddleware, (req, res) => {
  const userId = req.params.userId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  if (!sseClients.has(userId)) sseClients.set(userId, []);
  sseClients.get(userId).push(res);

  // Heartbeat every 30s to prevent proxy/LB timeouts
  const heartbeat = setInterval(() => {
    try {
      res.write(`:heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(userId) || [];
    sseClients.set(userId, clients.filter((c) => c !== res));
  });
});

// Gargoyle panic button — auth + stricter rate limit (Fix #1, #3, #10)
app.post("/gargoyle/:userId", getGargoyleLimiter(), authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const profile = await getProfile(userId);

    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await executeGargoyleProtocol({
      userId,
      userProfile: profile,
      triggerType: "panic_button",
      triggerSource: "pwa",
      messageContext: "Panic button pressed via PWA",
      location: req.body.location || null,
    });

    const constitution = resolveConstitution(profile);
    const grounding = getGroundingPrompt(constitution);

    res.json({
      success: result.success,
      grounding,
      alerts_sent: result.alerts_sent,
      cooldown: result.cooldown || false,
      cooldown_remaining: result.cooldown_remaining || 0,
    });
  } catch (err) {
    console.error("[GARGOYLE API] Error:", err);
    res.status(500).json({ error: "Gargoyle execution failed" });
  }
});

// Hydrate the inbox on load: profile, resolved constitution, and message history.
app.get("/api/state/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const profile = await getProfile(userId);
    if (!profile) return res.status(404).json({ error: "User not found. Complete onboarding first." });

    const constitution = resolveConstitution(profile);
    const snapshot = await getDb()
      .collection("users")
      .doc(userId)
      .collection("messages")
      .orderBy("created_at", "desc")
      .limit(200)
      .get();

    const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    const contacts = await getContacts(userId);

    res.json({ profile, constitution, messages, contacts });
  } catch (err) {
    console.error("[STATE API] Error:", err);
    res.status(500).json({ error: "Failed to load inbox state" });
  }
});

// List people/relationships
app.get("/api/contacts/:userId", authMiddleware, async (req, res) => {
  try {
    const contacts = await getContacts(req.params.userId);
    res.json({ contacts });
  } catch (err) {
    console.error("[CONTACTS API] Error:", err);
    res.status(500).json({ error: "Failed to load contacts" });
  }
});

// Upcoming Google Calendar events — requires `npm run connect:google` first.
app.get("/api/calendar/:userId", authMiddleware, async (req, res) => {
  try {
    const events = await getUpcomingEvents();
    if (events === null) {
      return res.status(404).json({ error: "Google Calendar isn't connected. Run `npm run connect:google`." });
    }
    res.json({ events });
  } catch (err) {
    console.error("[CALENDAR API] Error:", err);
    res.status(500).json({ error: "Failed to load calendar events" });
  }
});

// Add or edit a person's relationship info — name, relationship, notes,
// bucket. Works for a brand-new person (nobody's messaged yet) just as
// well as editing someone auto-created from an imported message.
app.post("/api/contacts/:userId/:contactId", authMiddleware, async (req, res) => {
  try {
    const { display_name, relationship_context, notes, bucket } = req.body;
    const update = {};
    if (display_name !== undefined) update.display_name = display_name;
    if (relationship_context !== undefined) update.relationship_context = relationship_context;
    if (notes !== undefined) update.notes = notes;
    if (bucket !== undefined) update.bucket = bucket;

    await upsertContact(req.params.userId, req.params.contactId, update);
    const contact = await getContact(req.params.userId, req.params.contactId);
    res.json({ success: true, contact });
  } catch (err) {
    console.error("[CONTACTS API] Error:", err);
    res.status(500).json({ error: "Failed to save contact" });
  }
});

// Create/update a user profile (onboarding PWA — replaces direct Firestore writes)
app.post("/api/profile", async (req, res) => {
  try {
    const { phone_number, ...profileData } = req.body;
    if (!phone_number) return res.status(400).json({ error: "phone_number required" });

    await upsertProfile(phone_number, profileData);
    res.json({ success: true });
  } catch (err) {
    console.error("[PROFILE API] Error:", err);
    res.status(500).json({ error: "Profile creation failed" });
  }
});

// Auth token generation (for onboarding PWA)
app.post("/auth/token", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const profile = await getProfile(userId);
    if (!profile) return res.status(404).json({ error: "User not found. Complete onboarding first." });

    const token = generateToken(userId);
    res.json({ token });
  } catch (err) {
    console.error("[AUTH] Token generation failed:", err);
    res.status(500).json({ error: "Token generation failed" });
  }
});

// ── Manual import: paste a single email in ──
app.post("/api/import/email/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { from, subject, body, date } = req.body;

    if (!body) return res.status(400).json({ error: "body required" });

    await processIncomingMessage({
      platform: "email",
      userId,
      senderId: from || "unknown@sender",
      senderName: from || "Unknown sender",
      messageText: subject ? `${subject}\n\n${body}` : body,
      messageId: `email_manual_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      isGroup: false,
      timestamp: date ? new Date(date) : new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[IMPORT EMAIL] Error:", err);
    res.status(500).json({ error: "Email import failed" });
  }
});

// ── Manual import: paste an exported WhatsApp chat in (.txt export format) ──
app.post("/api/import/whatsapp/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { chatText } = req.body;

    if (!chatText) return res.status(400).json({ error: "chatText required" });

    const parsed = parseWhatsAppExport(chatText);
    if (parsed.length === 0) {
      return res.status(400).json({ error: "Couldn't parse any messages from that export. Expected WhatsApp's standard 'chat export' .txt format." });
    }

    let imported = 0;
    for (const msg of parsed) {
      await processIncomingMessage({
        platform: "whatsapp_import",
        userId,
        senderId: msg.sender,
        senderName: msg.sender,
        messageText: msg.text,
        messageId: `wa_import_${msg.timestamp?.getTime() || Date.now()}_${imported}`,
        isGroup: false,
        timestamp: msg.timestamp || new Date(),
      });
      imported++;
    }

    res.json({ success: true, imported });
  } catch (err) {
    console.error("[IMPORT WHATSAPP] Error:", err);
    res.status(500).json({ error: "WhatsApp import failed" });
  }
});

app.listen(PORT, () => {
  console.log(`[LIBRARIAN] Express server on port ${PORT}`);
});

// ============================================================
// CORE PIPELINE — shared by every connector (email, manual imports, ...)
// ============================================================

/**
 * Run one incoming message through the full AXON pipeline: safety check,
 * triage, tone/translation, response generation, memory, storage, emit.
 *
 * @param {object} params
 * @param {string} params.platform — "email" | "whatsapp_import" | ...
 * @param {string} params.userId — the AXON account this message belongs to
 * @param {string} params.senderId — sender identifier (email address, contact name, phone, ...)
 * @param {string} params.senderName — human-readable sender label
 * @param {string} params.messageText
 * @param {string} params.messageId
 * @param {boolean} params.isGroup
 * @param {Date} params.timestamp
 */
async function processIncomingMessage({
  platform,
  userId,
  senderId,
  senderName,
  messageText,
  messageId,
  isGroup = false,
  timestamp = new Date(),
}) {
  // ── STEP 0: DEDUPLICATION ──
  if (isDuplicate(messageId)) {
    console.log(`[LIBRARIAN] Duplicate skipped: ${messageId}`);
    return;
  }

  // ── STEP 1: SAFETY WORD CHECK (BEFORE ANYTHING) ──
  const profile = await getProfile(userId);

  if (profile && profile.safety_word) {
    if (detectSafetyWord(messageText, profile.safety_word)) {
      console.warn(`[GARGOYLE] Safety word triggered for ${userId}`);

      const gargoyleResult = await executeGargoyleProtocol({
        userId,
        userProfile: profile,
        triggerType: "safety_word",
        triggerSource: platform,
        messageContext: `Safety word from ${senderId}`,
        location: null,
      });

      const constitution = resolveConstitution(profile);
      emitToUser(userId, {
        type: "gargoyle_activated",
        grounding: getGroundingPrompt(constitution),
        cooldown: gargoyleResult.cooldown || false,
        timestamp: new Date().toISOString(),
      });

      return; // HARD STOP
    }
  }

  // ── STEP 2: PROFILE + CONSTITUTION ──
  if (!profile) {
    emitToUser(userId, {
      type: "unregistered",
      message: "Set up your profile to start using AXON.",
    });
    return;
  }

  const constitution = resolveConstitution(profile);

  // ── STEP 2b: CONTACT / RELATIONSHIP (effortless — auto-created, never overwrites a name you've already set) ──
  const existingContact = await getContact(userId, senderId).catch(() => null);
  const resolvedSenderName = existingContact?.display_name || senderName;

  upsertContact(userId, senderId, {
    display_name: existingContact?.display_name || senderName,
    last_message_at: timestamp.toISOString(),
    message_count: (existingContact?.message_count || 0) + 1,
  }).catch((err) => console.error("[LIBRARIAN] Contact touch failed:", err.message));

  // ── STEP 3: TRIAGE ──
  const triageResult = await triageMessage({
    messageText,
    senderPhone: senderId,
    isGroup,
    contactBuckets: profile.contact_buckets,
    constitution,
    userKeys: profile.user_keys,
  });

  // ── STEP 4: CONTENT SCREENING ──
  let contentWarning = null;
  if (constitution?.triage?.content_screening) {
    contentWarning = screenContent(messageText, profile);
  }

  // ── STEP 5: CALENDAR EXTRACTION ──
  const calendarEvents = extractCalendarEvents(triageResult.events || []);

  // ── STEP 5b: TONE + SARCASM ANALYSIS ──
  const toneAnalysis = await analyzeMessage({
    text: messageText,
    constitution,
    userProfile: profile,
    userKeys: profile.user_keys,
  });

  // ── STEP 5c: TRANSLATION ──
  const translation = await translateMessage({
    text: messageText,
    constitution,
    userProfile: profile,
    userKeys: profile.user_keys,
  });

  // ── STEP 5d: RESPONSE TRINITY ──
  const trinity = await generateTrinity({
    originalText: messageText,
    translatedText: translation.translated,
    toneAnalysis,
    constitution,
    userProfile: profile,
    userKeys: profile.user_keys,
  });

  // ── STEP 5e: VOCAB TRACKING + GRADUATION PROPOSALS (non-blocking) ──
  Promise.allSettled([
    trackWordFrequency(userId, messageText),
    ...(profile.vocab_mode === "expand"
      ? extractNewWords(messageText, profile.restricted_vocab || []).map((word) =>
          proposeGraduation(userId, word, messageText.substring(0, 100))
        )
      : []),
  ]).catch((err) => console.error("[LIBRARIAN] Vocab tracking error:", err.message));

  // ── STEP 5f: MEMORY LAYER (non-blocking) ──
  processMessageIntoMemory({
    userId,
    message: { id: messageId, from: senderId, original_text: messageText },
    toneAnalysis,
    triageResult,
    userKeys: profile.user_keys,
  }).catch((err) => console.error("[LIBRARIAN] Memory engine error:", err.message));

  // ── STEP 6: STORE ──
  const processedMessage = {
    id: messageId,
    platform,
    from: senderId,
    from_name: resolvedSenderName,
    to: userId,
    original_text: messageText,
    translated_text: translation.translated,
    translation_ok: translation.simplified_ok,
    triage_pile: triageResult.pile,
    tone_analysis: {
      detected_tone: toneAnalysis.tone_key || "neutral",
      tone_label: toneAnalysis.tone_label,
      literal_meaning: toneAnalysis.literal_meaning,
      sarcasm_flag: toneAnalysis.sarcasm_detected,
      learn_why: translation.learn_why,
      sarcasm_explanation: toneAnalysis.explanation,
    },
    response_options: {
      mcq: trinity.mcq,
      ai_draft: trinity.ai_draft,
      manual: true,
      reply_expected: trinity.reply_expected,
      social_context: trinity.social_context,
    },
    read: false,
    replied: false,
    events_detected: calendarEvents,
    content_warning: contentWarning,
    action_items: triageResult.actionItems || [],
    summary: triageResult.summary,
    occurred_at: timestamp.toISOString(),
  };

  await saveMessage(userId, processedMessage);

  // ── STEP 7: EMIT ──
  emitToUser(userId, {
    type: "new_message",
    pile: triageResult.pile,
    message: processedMessage,
  });

  console.log(
    `[LIBRARIAN] [${platform}] ${senderId} → ${userId} | ${triageResult.pile} | events:${calendarEvents.length}`
  );
}

// ============================================================
// VOCAB HELPER
// ============================================================

/**
 * Extract words from a message that are NOT in the user's vocab list.
 * Used to propose graduations in EXPAND mode.
 */
function extractNewWords(text, vocabList) {
  if (!vocabList || vocabList.length === 0) return [];
  const vocabSet = new Set(vocabList.map((w) => w.toLowerCase()));
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || []; // 4+ char words only
  const unique = [...new Set(words)];
  return unique.filter((w) => !vocabSet.has(w)).slice(0, 5); // Max 5 proposals per message
}

// ============================================================
// CONTENT SCREENING
// ============================================================

function screenContent(text, profile) {
  const triggerWords = profile.trigger_words || [];
  const lower = text.toLowerCase();

  for (const word of triggerWords) {
    if (lower.includes(word.toLowerCase())) {
      return `This message may contain sensitive content related to: ${word}`;
    }
  }

  const distressKeywords = [
    "death", "died", "kill", "suicide", "abuse",
    "assault", "accident", "hospital", "emergency",
  ];

  for (const kw of distressKeywords) {
    if (lower.includes(kw)) {
      return "This message may contain distressing content. Tap to reveal when ready.";
    }
  }

  return null;
}

// ============================================================
// SSE EMITTERS
// ============================================================

function emitToUser(userId, data) {
  const clients = sseClients.get(userId) || [];
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { /* cleaned up on close */ }
  }
}

function emitToAllUsers(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const [, clients] of sseClients) {
    for (const client of clients) {
      try { client.write(payload); } catch { /* cleaned up on close */ }
    }
  }
}

// ============================================================
// START
// ============================================================

startWuphfScheduler(emitToUser);

// Live email connector — only starts if EMAIL_IMAP_* env vars are set.
// Non-fatal if absent/misconfigured: manual import + everything else
// keeps working either way.
startEmailImapConnector({
  onMessage: processIncomingMessage,
  onStatusChange: (status) => { emailConnectorStatus = status; },
}).catch((err) => {
  emailConnectorStatus = "error";
  console.error("[LIBRARIAN] Email connector failed to start:", err.message);
});

// Live Gmail connector (Gmail API via OAuth) — only starts if Google
// credentials from `npm run connect:google` are present. Non-fatal
// either way.
startGmailConnector({
  onMessage: processIncomingMessage,
  onStatusChange: (status) => { gmailConnectorStatus = status; },
}).catch((err) => {
  gmailConnectorStatus = "error";
  console.error("[LIBRARIAN] Gmail connector failed to start:", err.message);
});

module.exports = { app, emitToUser, processIncomingMessage };
