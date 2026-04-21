/**
 * memoryEngine.js — Pattern Analysis & Relationship Memory
 *
 * Builds a relational map between:
 *   - User's texting patterns (when, to whom, how fast, what emotion)
 *   - Contact relationship clusters (dominant tone, intent, sarcasm rate)
 *   - Emotion + intent trends over time
 *
 * Runs:
 *   - Per message (real-time contact memory update)
 *   - Daily (pattern snapshot via cron)
 *
 * All data stays in user's Firestore. PRIVACY_ABSOLUTE compliant.
 */

const Groq = require("groq-sdk");
const { getGroqConfig } = require("./config");
const {
  storeMessageEmbedding,
  updateContactMemory,
  getContactMemory,
  storePattern,
  semanticSearch,
} = require("./vectorStore");
const { getDb } = require("./firebaseSchema");

// ============================================================
// REAL-TIME: PROCESS MESSAGE INTO MEMORY
// ============================================================

/**
 * Process a message into the memory layer.
 * Called after triage + translation in librarian.js pipeline.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {object} params.message — processed message from librarian
 * @param {object} params.toneAnalysis — from sarcasmEngine
 * @param {object} params.triageResult — from triage
 * @param {object|null} params.userKeys
 */
async function processMessageIntoMemory({
  userId,
  message,
  toneAnalysis,
  triageResult,
  userKeys = null,
}) {
  const metadata = {
    pile: triageResult.pile,
    tone: toneAnalysis?.tone_key || "neutral",
    emotion: toneAnalysis?.tone_key || "neutral",
    intent: detectIntent(triageResult),
    sarcasm: toneAnalysis?.sarcasm_detected || false,
    from: message.from,
    replied: false,
    reply_speed_mins: null,
  };

  // Run both operations in parallel — don't block main pipeline
  await Promise.allSettled([
    storeMessageEmbedding({
      userId,
      messageId: message.id,
      text: message.original_text,
      metadata,
      userKeys,
    }),
    updateContactMemory(userId, message.from, metadata),
  ]);
}

/**
 * Update memory when user replies to a message.
 * Records reply speed — key signal for pattern analysis.
 *
 * @param {string} userId
 * @param {string} messageId
 * @param {number} replySpeedMins
 */
async function recordReply(userId, messageId, replySpeedMins) {
  try {
    await getDb()
      .collection("users")
      .doc(userId)
      .collection("embeddings")
      .doc(messageId)
      .update({
        "metadata.replied": true,
        "metadata.reply_speed_mins": replySpeedMins,
      });
  } catch (err) {
    console.error("[MEMORY] recordReply failed:", err.message);
  }
}

// ============================================================
// INTENT DETECTION (rule-based, no LLM)
// ============================================================

/**
 * Detect message intent from triage result.
 * Fast, no LLM — pattern matching on triage output.
 */
function detectIntent(triageResult) {
  if (!triageResult) return "unknown";

  if (triageResult.actionItems?.length > 0) return "request";
  if (triageResult.events?.length > 0) return "scheduling";

  const text = (triageResult.summary || "").toLowerCase();

  if (/\?/.test(text)) return "question";
  if (/thank|appreciate|grateful/i.test(text)) return "gratitude";
  if (/sorry|apologize|apolog/i.test(text)) return "apology";
  if (/check|how are|how's|how is/i.test(text)) return "check_in";
  if (/meet|call|zoom|chat|talk/i.test(text)) return "scheduling";
  if (/urgent|asap|emergency|now/i.test(text)) return "urgent";

  return "informational";
}

// ============================================================
// DAILY PATTERN ANALYSIS
// ============================================================

/**
 * Analyse a user's texting patterns from the last 30 days of embeddings.
 * Stores result as a pattern snapshot.
 *
 * @param {string} userId
 * @param {object|null} userKeys
 */
async function analysePatterns(userId, userKeys = null) {
  try {
    // Get last 30 days of embeddings
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snapshot = await getDb()
      .collection("users")
      .doc(userId)
      .collection("embeddings")
      .where("created_at", ">=", thirtyDaysAgo)
      .orderBy("created_at", "desc")
      .limit(500)
      .get();

    if (snapshot.empty) return;

    const messages = snapshot.docs.map((d) => d.data());

    // ── Tone distribution ──
    const toneDist = {};
    for (const m of messages) {
      const tone = m.metadata?.tone || "neutral";
      toneDist[tone] = (toneDist[tone] || 0) + 1;
    }

    // ── Intent distribution ──
    const intentDist = {};
    for (const m of messages) {
      const intent = m.metadata?.intent || "unknown";
      intentDist[intent] = (intentDist[intent] || 0) + 1;
    }

    // ── Reply rate ──
    const replied = messages.filter((m) => m.metadata?.replied);
    const replyRate = messages.length > 0 ? replied.length / messages.length : 0;

    // ── Average reply speed ──
    const replySpeeds = replied
      .map((m) => m.metadata?.reply_speed_mins)
      .filter((s) => s !== null && s !== undefined);
    const avgReplySpeed = replySpeeds.length > 0
      ? replySpeeds.reduce((a, b) => a + b, 0) / replySpeeds.length
      : null;

    // ── Sarcasm exposure rate ──
    const sarcasmCount = messages.filter((m) => m.metadata?.sarcasm).length;
    const sarcasmRate = messages.length > 0 ? sarcasmCount / messages.length : 0;

    // ── Pile distribution ──
    const pileDist = {};
    for (const m of messages) {
      const pile = m.metadata?.pile || "casual";
      pileDist[pile] = (pileDist[pile] || 0) + 1;
    }

    // ── Most active contact ──
    const contactFreq = {};
    for (const m of messages) {
      if (m.metadata?.from) {
        contactFreq[m.metadata.from] = (contactFreq[m.metadata.from] || 0) + 1;
      }
    }
    const mostActiveContact = Object.entries(contactFreq)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const pattern = {
      period_days: 30,
      message_count: messages.length,
      tone_distribution: toneDist,
      intent_distribution: intentDist,
      reply_rate: Math.round(replyRate * 100) / 100,
      avg_reply_speed_mins: avgReplySpeed ? Math.round(avgReplySpeed) : null,
      sarcasm_exposure_rate: Math.round(sarcasmRate * 100) / 100,
      pile_distribution: pileDist,
      most_active_contact: mostActiveContact,
    };

    await storePattern(userId, pattern);

    console.log(`[MEMORY] Pattern analysis complete for ${userId}`);
    return pattern;
  } catch (err) {
    console.error("[MEMORY] Pattern analysis failed:", err.message);
  }
}

// ============================================================
// CONTACT RELATIONSHIP SUMMARY (LLM-generated)
// ============================================================

/**
 * Generate a plain-language relationship summary for a contact.
 * Stored in contact_memory for use in triage pre-context.
 *
 * @param {string} userId
 * @param {string} contactPhone
 * @param {object|null} userKeys
 */
async function generateRelationshipSummary(userId, contactPhone, userKeys = null) {
  const memory = await getContactMemory(userId, contactPhone);
  if (!memory || memory.message_count < 5) return; // Need enough data

  try {
    const groqConfig = getGroqConfig(userKeys);
    const groq = new Groq({ apiKey: groqConfig.apiKey });

    const completion = await groq.chat.completions.create({
      model: groqConfig.triageModel,
      messages: [
        {
          role: "system",
          content: "Summarize a contact's communication pattern in 1 plain sentence for a neurodivergent user. Be literal. No filler. Example: 'This person usually sends urgent messages and is often sarcastic.'",
        },
        {
          role: "user",
          content: JSON.stringify({
            message_count: memory.message_count,
            dominant_tone: memory.dominant_tone,
            dominant_emotion: memory.dominant_emotion,
            sarcasm_rate: memory.sarcasm_rate,
            dominant_pile: memory.dominant_pile,
          }),
        },
      ],
      temperature: 0.1,
      max_tokens: 80,
    });

    const summary = completion.choices[0]?.message?.content?.trim();
    if (!summary) return;

    await getDb()
      .collection("users")
      .doc(userId)
      .collection("contact_memory")
      .doc(contactPhone.replace(/\D/g, ""))
      .update({ relationship_summary: summary });
  } catch (err) {
    console.error("[MEMORY] Relationship summary failed:", err.message);
  }
}

/**
 * Get contact memory to inject as pre-context into triage.
 * Tells triage "this person is usually sarcastic" before LLM runs.
 *
 * @param {string} userId
 * @param {string} contactPhone
 * @returns {string|null} context string for LLM system prompt
 */
async function getContactContext(userId, contactPhone) {
  const memory = await getContactMemory(userId, contactPhone);
  if (!memory) return null;

  if (memory.relationship_summary) {
    return `Contact history: ${memory.relationship_summary}`;
  }

  if (memory.message_count >= 3) {
    return `Contact history: ${memory.message_count} messages. Usually ${memory.dominant_tone} tone. ${
      memory.sarcasm_rate > 0.3 ? "Often sarcastic." : ""
    }`;
  }

  return null;
}

module.exports = {
  processMessageIntoMemory,
  recordReply,
  analysePatterns,
  generateRelationshipSummary,
  getContactContext,
  detectIntent,
};
