/**
 * responseGenerator.js — Response Trinity Generator (Phase 3)
 *
 * Generates all three Trinity options for every message:
 *   1. MCQ Chips — 3 intent-based reply suggestions
 *   2. AI Draft — full restricted-vocab reply
 *   3. Manual — always available ("Something Else")
 *
 * Also provides:
 *   - Tone Mirror: feedback on user's draft ("sounds friendly ✓")
 *   - Social obligation indicator: "Reply expected" vs "Optional"
 *
 * Constitutional compliance:
 *   - TRINITY_REPLY: all three options ALWAYS present
 *   - LITERAL_MANDATE: all suggestions in restricted vocab
 *   - SCAFFOLDING_GROWTH: Tone Mirror teaches, not judges
 */

const Groq = require("groq-sdk");
const { getGroqConfig } = require("./config");

async function withRetry(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransient = err.status === 429 || err.status >= 500 ||
        err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
      if (!isTransient) throw err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ============================================================
// TRINITY GENERATOR
// ============================================================

/**
 * Generate all three Trinity response options for a message.
 *
 * @param {object} params
 * @param {string} params.originalText — original incoming message
 * @param {string} params.translatedText — translated version
 * @param {object} params.toneAnalysis — from sarcasmEngine
 * @param {object} params.constitution — resolved rules
 * @param {object} params.userProfile — for vocab + reading level
 * @param {object|null} params.userKeys — BYOK
 * @returns {object} { mcq, ai_draft, manual, reply_expected }
 */
async function generateTrinity({
  originalText,
  translatedText,
  toneAnalysis,
  constitution,
  userProfile,
  userKeys = null,
}) {
  const groqConfig = getGroqConfig(userKeys);
  const groq = new Groq({ apiKey: groqConfig.apiKey });

  const readingLevel = userProfile.reading_level || 3;
  const restrictedVocab = userProfile.restricted_vocab || [];
  const draftLengthCap = constitution?.response?.draft_length_cap || 3;

  const systemPrompt = buildTrinitySystemPrompt({
    constitution,
    readingLevel,
    restrictedVocab,
    draftLengthCap,
  });

  try {
    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: groqConfig.translateModel, // 70B for quality
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              original_message: originalText,
              translated_message: translatedText,
              detected_tone: toneAnalysis?.tone_key || "neutral",
              literal_meaning: toneAnalysis?.literal_meaning || originalText,
            }),
          },
        ],
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: "json_object" },
      })
    );

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return {
      mcq: sanitizeMCQ(parsed.mcq || []),
      ai_draft: parsed.ai_draft || "",
      manual: true, // ALWAYS true — Trinity mandate
      reply_expected: parsed.reply_expected ?? true,
      reply_urgency: parsed.reply_urgency || "none",
      social_context: parsed.social_context || null,
    };
  } catch (err) {
    console.error("[RESPONSE GEN] Trinity generation failed:", err.message);
    return buildFallbackTrinity(originalText, constitution);
  }
}

// ============================================================
// TONE MIRROR
// ============================================================

/**
 * Analyze a user's draft reply and provide feedback.
 * Teaches, never judges.
 *
 * @param {object} params
 * @param {string} params.draftText — user's typed draft
 * @param {string} params.originalMessage — what they're replying to
 * @param {object} params.constitution — resolved rules
 * @param {object} params.userProfile
 * @param {object|null} params.userKeys
 * @returns {object} { rating, label, feedback, is_safe_to_send }
 */
async function getToneMirror({
  draftText,
  originalMessage,
  constitution,
  userProfile,
  userKeys = null,
}) {
  if (!draftText || draftText.trim().length < 2) {
    return { rating: null, label: null, feedback: null, is_safe_to_send: false };
  }

  const groqConfig = getGroqConfig(userKeys);
  const groq = new Groq({ apiKey: groqConfig.apiKey });
  const readingLevel = userProfile.reading_level || 3;

  // Apply OCD good-enough nudge
  const goodEnoughNudge = constitution?.response?.good_enough_nudge;

  try {
    const completion = await groq.chat.completions.create({
      model: groqConfig.triageModel, // 8B — fast for real-time feedback
      messages: [
        {
          role: "system",
          content: `You analyze message drafts for a neurodivergent user learning social communication.

Your job: Give brief, kind, constructive feedback on the tone of their draft reply.
Reading level of feedback: Grade ${readingLevel}.
NEVER shame or criticize. ALWAYS encourage.
${goodEnoughNudge ? "If the draft is clear enough, always confirm it is good to send." : ""}

Respond ONLY with valid JSON. No markdown.

JSON format:
{
  "rating": "friendly" | "neutral" | "too_blunt" | "too_long" | "unclear" | "good",
  "label": "Short label shown in UI. Max 5 words. Examples: 'Sounds friendly ✓' or 'Could be clearer'",
  "feedback": "1 sentence of plain feedback. Grade ${readingLevel} language. No jargon.",
  "is_safe_to_send": boolean,
  "suggestion": "Optional: one specific word change to improve it, or null"
}`,
        },
        {
          role: "user",
          content: JSON.stringify({
            original_message: originalMessage,
            draft_reply: draftText,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return {
      rating: parsed.rating || "neutral",
      label: parsed.label || "Draft looks okay",
      feedback: parsed.feedback || null,
      is_safe_to_send: parsed.is_safe_to_send ?? true,
      suggestion: parsed.suggestion || null,
    };
  } catch (err) {
    console.error("[TONE MIRROR] Failed:", err.message);
    return {
      rating: "neutral",
      label: "Draft looks okay",
      feedback: null,
      is_safe_to_send: true,
      suggestion: null,
    };
  }
}

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

function buildTrinitySystemPrompt({ constitution, readingLevel, restrictedVocab, draftLengthCap }) {
  const vocabInstruction = restrictedVocab.length > 0
    ? `Use ONLY these approved words where possible: [${restrictedVocab.join(", ")}].`
    : "Use simple, plain language.";

  const rules = [
    `Write for Grade ${readingLevel} reading level.`,
    vocabInstruction,
    "Output ZERO filler. ZERO politeness padding.",
    "Be direct and literal.",
    `AI draft: maximum ${draftLengthCap} sentences.`,
    "MCQ chips: exactly 3 options, each max 8 words.",
    "Each MCQ chip should represent a DIFFERENT intent (agree, decline, ask question, acknowledge, etc.).",
  ];

  if (constitution?.response?.social_scripts) {
    rules.push("Include a social context note explaining the expected social norms for this reply.");
  }

  if (constitution?.language?.tone_softening) {
    rules.push("Keep all reply suggestions warm and non-confrontational.");
  }

  if (constitution?.response?.send_delay) {
    rules.push(`Note: user has a ${constitution.response.send_delay}s send delay configured.`);
  }

  return `You generate reply options for a neurodivergent user.

RULES:
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Respond ONLY with valid JSON. No markdown.

JSON format:
{
  "mcq": [
    { "label": "Short chip label", "full_text": "Full reply text the user would send" },
    { "label": "Short chip label", "full_text": "Full reply text the user would send" },
    { "label": "Short chip label", "full_text": "Full reply text the user would send" }
  ],
  "ai_draft": "Full AI-generated reply ready to send",
  "reply_expected": boolean — is a reply socially expected for this message,
  "reply_urgency": "none" | "low" | "medium" | "high",
  "social_context": "Optional: 1 sentence explaining the social situation. Null if not needed."
}`;
}

// ============================================================
// SANITIZERS + FALLBACKS
// ============================================================

function sanitizeMCQ(mcq) {
  // Ensure exactly 3 chips, always
  const base = Array.isArray(mcq) ? mcq.slice(0, 3) : [];

  const defaults = [
    { label: "Okay", full_text: "Okay." },
    { label: "Got it", full_text: "Got it." },
    { label: "Need time", full_text: "I need some time to think about this." },
  ];

  while (base.length < 3) {
    base.push(defaults[base.length]);
  }

  return base.map((chip) => ({
    label: chip.label || "Reply",
    full_text: chip.full_text || chip.label || "Okay.",
  }));
}

function buildFallbackTrinity(originalText, constitution) {
  // Sensible hardcoded fallback when LLM is unavailable
  const isQuestion = originalText.includes("?");

  return {
    mcq: [
      { label: "Okay", full_text: "Okay." },
      { label: isQuestion ? "Not sure" : "Got it", full_text: isQuestion ? "I'm not sure yet." : "Got it." },
      { label: "Need time", full_text: "I need some time to think about this." },
    ],
    ai_draft: isQuestion ? "I'll get back to you on this." : "Okay, understood.",
    manual: true,
    reply_expected: isQuestion,
    reply_urgency: "none",
    social_context: null,
  };
}

module.exports = {
  generateTrinity,
  getToneMirror,
};
