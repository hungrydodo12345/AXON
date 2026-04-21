/**
 * triage.js — Four-Pile Message Triage
 *
 * Piles:
 *   1. Important — VIP/Work actionable → instant alert
 *   2. Social    — VIP non-urgent → summarized
 *   3. Casual    — Non-VIP → summarized
 *   4. Archive   — Groups → compressed to 1 sentence
 *
 * Uses Groq API with Llama 3 8B for fast classification.
 * Constitution rules modify triage behavior per profile.
 */

const Groq = require("groq-sdk");
const { getGroqConfig } = require("./config");

// ============================================================
// RETRY LOGIC FOR GROQ API
// ============================================================

/**
 * Retry a function with exponential backoff.
 * @param {Function} fn — async function to retry
 * @param {number} maxRetries — max attempts (default 3)
 * @param {number} baseDelayMs — starting delay (default 1000ms)
 * @returns {*} result of fn
 */
async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err.status === 429;
      const isServerError = err.status >= 500;
      const isTimeout = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";

      // Only retry on transient errors
      if (!isRateLimit && !isServerError && !isTimeout) {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`[GROQ] Attempt ${attempt}/${maxRetries} failed (${err.message}). Retrying in ${Math.round(delay)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Determine which pile a message belongs in.
 *
 * @param {object} params
 * @param {string} params.messageText — raw message text
 * @param {string} params.senderPhone — sender's phone number
 * @param {boolean} params.isGroup — is this a group message
 * @param {object} params.contactBuckets — user's contact bucket map
 * @param {object} params.constitution — resolved constitution rules
 * @param {object|null} params.userKeys — BYOK overrides
 * @returns {object} { pile, reason, summary, actionItems, events }
 */
async function triageMessage({
  messageText,
  senderPhone,
  isGroup,
  contactBuckets,
  constitution,
  userKeys = null,
}) {
  // Step 1: Determine sender bucket
  const bucket = getSenderBucket(senderPhone, contactBuckets);

  // Step 2: If muted, auto-archive
  if (bucket === "mute") {
    return {
      pile: "archive",
      reason: "Contact is muted.",
      summary: "",
      actionItems: [],
      events: [],
    };
  }

  // Step 3: Groups → archive with 1-sentence compression
  if (isGroup) {
    const summary = await compressGroupMessage(messageText, userKeys);
    return {
      pile: "archive",
      reason: "Group message compressed.",
      summary,
      actionItems: [],
      events: [],
    };
  }

  // Step 4: LLM classification for non-group, non-muted messages
  const analysis = await classifyMessage(messageText, bucket, constitution, userKeys);

  // Step 5: Apply bucket-based pile mapping
  const pile = determinePile(bucket, analysis);

  return {
    pile,
    reason: analysis.reason,
    summary: analysis.summary,
    actionItems: analysis.actionItems || [],
    events: analysis.events || [],
  };
}

// ============================================================
// SENDER BUCKET LOOKUP
// ============================================================

/**
 * Find which bucket a sender belongs to.
 * @param {string} phone
 * @param {object} buckets — { vip: [], work: [], casual: [], mute: [] }
 * @returns {string} bucket name, defaults to "casual"
 */
function getSenderBucket(phone, buckets) {
  if (!buckets) return "casual";

  const normalized = phone.replace(/\D/g, "");

  for (const [bucket, phones] of Object.entries(buckets)) {
    if (Array.isArray(phones)) {
      for (const p of phones) {
        if (p.replace(/\D/g, "") === normalized) {
          return bucket;
        }
      }
    }
  }

  return "casual";
}

// ============================================================
// LLM CLASSIFICATION (Groq / Llama 3 8B)
// ============================================================

/**
 * Classify a message using Groq API.
 * @returns {{ isActionable, urgency, summary, reason, actionItems, events }}
 */
async function classifyMessage(messageText, bucket, constitution, userKeys) {
  const groqConfig = getGroqConfig(userKeys);
  const groq = new Groq({ apiKey: groqConfig.apiKey });

  const constitutionContext = buildConstitutionContext(constitution);

  const systemPrompt = `You are a message triage assistant for a neurodivergent user.
Your job is to classify messages and extract key information.

${constitutionContext}

Respond ONLY with valid JSON. No other text. No markdown. No backticks.

JSON format:
{
  "is_actionable": boolean,
  "urgency": "high" | "medium" | "low" | "none",
  "summary": "1-2 sentence plain summary",
  "reason": "why this classification",
  "action_items": ["list of tasks detected"] or [],
  "events": [{"description": "event name", "date": "detected date/time or null"}] or [],
  "tone": "detected tone",
  "sarcasm_detected": boolean,
  "literal_meaning": "what the message literally means"
}`;

  try {
    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: groqConfig.triageModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Sender bucket: ${bucket}\nMessage: ${messageText}` },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
      })
    );

    const text = completion.choices[0]?.message?.content || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      isActionable: parsed.is_actionable || false,
      urgency: parsed.urgency || "none",
      summary: parsed.summary || messageText.substring(0, 100),
      reason: parsed.reason || "LLM classification",
      actionItems: parsed.action_items || [],
      events: parsed.events || [],
      tone: parsed.tone || "neutral",
      sarcasmDetected: parsed.sarcasm_detected || false,
      literalMeaning: parsed.literal_meaning || messageText,
    };
  } catch (err) {
    console.error("[TRIAGE] Groq classification failed:", err.message);

    // Fallback: rule-based classification
    return fallbackClassification(messageText, bucket);
  }
}

/**
 * Build constitution-specific instructions for the LLM.
 */
function buildConstitutionContext(constitution) {
  const parts = [];

  if (constitution?.triage?.urgency_timers === false) {
    parts.push("Do NOT assign urgency timers. This user does not want time pressure.");
  }

  if (constitution?.triage?.content_screening) {
    parts.push("Flag any potentially distressing content with a content warning.");
  }

  if (constitution?.triage?.change_alerts) {
    parts.push("Flag any schedule or routine changes as high urgency.");
  }

  if (constitution?.language?.max_sentences) {
    parts.push(`Keep summaries to ${constitution.language.max_sentences} sentences max.`);
  }

  if (constitution?.triage?.social_obligation_label) {
    parts.push("Include whether a reply is expected or optional.");
  }

  return parts.length > 0
    ? "Constitution rules for this user:\n- " + parts.join("\n- ")
    : "";
}

/**
 * Fallback rule-based classification when LLM is unavailable.
 */
function fallbackClassification(messageText, bucket) {
  const lower = messageText.toLowerCase();
  const hasQuestion = lower.includes("?");
  const hasUrgentWords = /urgent|asap|emergency|important|deadline|now|hurry/i.test(lower);
  const hasEventWords = /meeting|call|appointment|event|tomorrow|tonight|schedule/i.test(lower);

  return {
    isActionable: hasQuestion || hasUrgentWords,
    urgency: hasUrgentWords ? "high" : hasQuestion ? "medium" : "low",
    summary: messageText.substring(0, 100),
    reason: "Fallback rule-based classification (LLM unavailable)",
    actionItems: hasQuestion ? ["Reply to question"] : [],
    events: hasEventWords ? [{ description: "Possible event detected", date: null }] : [],
    tone: "unknown",
    sarcasmDetected: false,
    literalMeaning: messageText,
  };
}

// ============================================================
// PILE DETERMINATION
// ============================================================

/**
 * Map bucket + analysis to a pile.
 * @param {string} bucket — vip | work | casual | mute
 * @param {object} analysis — from classifyMessage
 * @returns {string} pile name
 */
function determinePile(bucket, analysis) {
  // VIP + actionable → Important
  if ((bucket === "vip" || bucket === "work") && analysis.isActionable) {
    return "important";
  }

  // VIP + not actionable → Social
  if (bucket === "vip" && !analysis.isActionable) {
    return "social";
  }

  // Work + not actionable but has events → Important
  if (bucket === "work" && analysis.events.length > 0) {
    return "important";
  }

  // Work + not actionable → Social
  if (bucket === "work") {
    return "social";
  }

  // Casual → Casual
  return "casual";
}

// ============================================================
// GROUP COMPRESSION
// ============================================================

/**
 * Compress a group message to 1 sentence.
 * @param {string} messageText
 * @param {object|null} userKeys
 * @returns {string}
 */
async function compressGroupMessage(messageText, userKeys) {
  try {
    const groqConfig = getGroqConfig(userKeys);
    const groq = new Groq({ apiKey: groqConfig.apiKey });

    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: groqConfig.triageModel,
        messages: [
          {
            role: "system",
            content: "Compress the following group message into exactly 1 short sentence. No filler. No opinions. Just the fact.",
          },
          { role: "user", content: messageText },
        ],
        temperature: 0.1,
        max_tokens: 60,
      })
    );

    return completion.choices[0]?.message?.content?.trim() || messageText.substring(0, 80);
  } catch {
    return messageText.substring(0, 80) + "...";
  }
}

module.exports = {
  triageMessage,
  getSenderBucket,
  classifyMessage,
  determinePile,
  compressGroupMessage,
};
