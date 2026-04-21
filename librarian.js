/**
 * librarian.js — Main WhatsApp Bridge (Librarian)
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
 * Security:
 *   - Auth: HMAC token verification on all endpoints
 *   - CORS: restricted to ALLOWED_ORIGINS only
 *   - Rate limiting: per-IP general + per-endpoint specific
 *
 * Reliability:
 *   - WhatsApp auto-reconnection with exponential backoff
 *   - SSE heartbeat every 30s (prevents proxy timeouts)
 *   - Message deduplication (10-min TTL in-memory cache)
 *   - Groq retry logic (handled in triage.js)
 *
 * Constitutional compliance:
 *   - SAFETY_BYPASS: Safety word is FIRST meaningful check
 *   - PRIVACY_ABSOLUTE: all data in user's Firestore
 *   - BYOK: keys resolved per-user
 */

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const { validateBootConfig } = require("./config");
const { initFirebase, getProfile, saveMessage } = require("./firebaseSchema");
const { detectSafetyWord, executeGargoyleProtocol, getGroundingPrompt } = require("./gargoyle");
const { resolveConstitution } = require("./constitutionEngine");
const { triageMessage } = require("./triage");
const { extractCalendarEvents, startWuphfScheduler } = require("./wuphf");
const { analyzeMessage } = require("./sarcasmEngine");
const { translateMessage } = require("./translator");
const { generateTrinity } = require("./responseGenerator");
const { processMessageIntoMemory } = require("./memoryEngine");
const { trackWordFrequency, proposeGraduation } = require("./growthTracker");
const {
  applySecurityMiddleware,
  authMiddleware,
  getGargoyleLimiter,
  getSseLimiter,
  generateToken,
} = require("./middleware");

// ============================================================
// BOOT VALIDATION
// ============================================================

const bootCheck = validateBootConfig();
if (!bootCheck.valid) {
  console.error("╔══════════════════════════════════════════╗");
  console.error("║  NEURO-LIBRARIAN — BOOT FAILED           ║");
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

// Apply security middleware (helmet, CORS, rate limit)
applySecurityMiddleware(app);
app.use(express.json());

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
    whatsapp: whatsapp.info ? "connected" : "disconnected",
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
      whatsappClient: whatsapp,
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

app.listen(PORT, () => {
  console.log(`[LIBRARIAN] Express server on port ${PORT}`);
});

// ============================================================
// WHATSAPP CLIENT (with auto-reconnection — Fix #9)
// ============================================================

const whatsapp = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

whatsapp.on("qr", (qr) => {
  console.log("[LIBRARIAN] Scan QR code to connect WhatsApp:");
  qrcode.generate(qr, { small: true });
});

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY = 5000;

whatsapp.on("ready", () => {
  reconnectAttempts = 0; // Reset on successful connection
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  NEURO-LIBRARIAN — BRIDGE ONLINE          ║");
  console.log("║  WhatsApp: CONNECTED                      ║");
  console.log("║  Safety Word: ACTIVE                      ║");
  console.log("║  Triage: READY                             ║");
  console.log("║  WUPHF Nudges: ACTIVE                     ║");
  console.log("║  Security: AUTH + CORS + RATE LIMIT        ║");
  console.log("║  Deduplication: ACTIVE                     ║");
  console.log("╚══════════════════════════════════════════╝");

  startWuphfScheduler(emitToUser);
});

whatsapp.on("auth_failure", (msg) => {
  console.error("[LIBRARIAN] WhatsApp auth failed:", msg);
});

whatsapp.on("disconnected", (reason) => {
  console.warn("[LIBRARIAN] WhatsApp disconnected:", reason);

  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1);
    console.log(`[LIBRARIAN] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

    setTimeout(() => {
      whatsapp.initialize().catch((err) => {
        console.error("[LIBRARIAN] Reconnection failed:", err.message);
      });
    }, delay);
  } else {
    console.error("[LIBRARIAN] Max reconnect attempts reached. Manual restart required.");
    emitToAllUsers({
      type: "system_error",
      message: "WhatsApp connection lost. Service restart needed.",
    });
  }
});

// ============================================================
// MESSAGE LISTENER — CORE PIPELINE
// ============================================================

whatsapp.on("message", async (message) => {
  try {
    await processMessage(message);
  } catch (err) {
    console.error("[LIBRARIAN] Unhandled error:", err);
  }
});

async function processMessage(message) {
  const userPhone = message.to;
  const senderPhone = message.from;
  const messageText = message.body || "";
  const messageId = message.id?._serialized || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const isGroup = message.from.includes("@g.us");

  // ── STEP 0: DEDUPLICATION ──
  if (isDuplicate(messageId)) {
    console.log(`[LIBRARIAN] Duplicate skipped: ${messageId}`);
    return;
  }

  // ── STEP 1: SAFETY WORD CHECK (BEFORE ANYTHING) ──
  const profile = await getProfile(userPhone);

  if (profile && profile.safety_word) {
    if (detectSafetyWord(messageText, profile.safety_word)) {
      console.warn(`[GARGOYLE] Safety word triggered for ${userPhone}`);

      const gargoyleResult = await executeGargoyleProtocol({
        userId: userPhone,
        userProfile: profile,
        triggerType: "safety_word",
        triggerSource: "whatsapp",
        messageContext: `Safety word from ${senderPhone}`,
        location: null,
        whatsappClient: whatsapp,
      });

      const constitution = resolveConstitution(profile);
      emitToUser(userPhone, {
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
    emitToUser(userPhone, {
      type: "unregistered",
      message: "Set up your profile to start using Neuro-Librarian.",
    });
    return;
  }

  const constitution = resolveConstitution(profile);

  // ── STEP 3: TRIAGE ──
  const triageResult = await triageMessage({
    messageText,
    senderPhone,
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
    trackWordFrequency(userPhone, messageText),
    ...(profile.vocab_mode === "expand"
      ? extractNewWords(messageText, profile.restricted_vocab || []).map((word) =>
          proposeGraduation(userPhone, word, messageText.substring(0, 100))
        )
      : []),
  ]).catch((err) => console.error("[LIBRARIAN] Vocab tracking error:", err.message));

  // ── STEP 5f: MEMORY LAYER (non-blocking) ──
  processMessageIntoMemory({
    userId: userPhone,
    message: { id: messageId, from: senderPhone, original_text: messageText },
    toneAnalysis,
    triageResult,
    userKeys: profile.user_keys,
  }).catch((err) => console.error("[LIBRARIAN] Memory engine error:", err.message));

  // ── STEP 6: STORE ──
  const processedMessage = {
    id: messageId,
    from: senderPhone,
    to: userPhone,
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
  };

  await saveMessage(userPhone, processedMessage);

  // ── STEP 7: EMIT ──
  emitToUser(userPhone, {
    type: "new_message",
    pile: triageResult.pile,
    message: processedMessage,
  });

  console.log(
    `[LIBRARIAN] ${senderPhone} → ${userPhone} | ${triageResult.pile} | events:${calendarEvents.length}`
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

whatsapp.initialize();

module.exports = { app, whatsapp, emitToUser };
