/**
 * translator.js — Translation Engine (Phase 3)
 *
 * Uses Groq API / Llama 3 70B to:
 *   1. Enforce restricted vocabulary (user's word list only)
 *   2. Enforce reading level (Grade 1-5)
 *   3. Apply constitution-driven language rules per profile
 *   4. Return both translated text AND "See Original" toggle data
 *
 * Constitutional compliance:
 *   - LITERAL_MANDATE: zero filler, zero social smoothing
 *   - SCAFFOLDING_GROWTH: always returns original + explanation
 *   - If simplification fails → "Concept too complex for current word list."
 */

const Groq = require("groq-sdk");
const { getGroqConfig } = require("./config");

// ============================================================
// RETRY (shared pattern from triage.js)
// ============================================================

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
// READING LEVEL DESCRIPTORS
// ============================================================

const READING_LEVEL_DESCRIPTORS = {
  1: "a 6-year-old child. Use only the simplest, most common words. Maximum 6 words per sentence. No complex ideas.",
  2: "a 8-year-old child. Use simple everyday words. Maximum 8 words per sentence. One idea per sentence.",
  3: "a 10-year-old. Use common words. Short sentences. No jargon.",
  4: "a 13-year-old. Clear language. Avoid technical terms unless necessary.",
  5: "a 16-year-old. Normal adult language but keep it clear and direct.",
};

// ============================================================
// MAIN TRANSLATION FUNCTION
// ============================================================

/**
 * Translate a message according to the user's constitution.
 *
 * @param {object} params
 * @param {string} params.text — original message text
 * @param {object} params.constitution — resolved constitution rules
 * @param {object} params.userProfile — for vocab + reading level
 * @param {object|null} params.userKeys — BYOK
 * @returns {object} { translated, original, learn_why, simplified_ok }
 */
async function translateMessage({ text, constitution, userProfile, userKeys = null }) {
  const groqConfig = getGroqConfig(userKeys);
  const groq = new Groq({ apiKey: groqConfig.apiKey });

  const readingLevel = userProfile.reading_level || 3;
  const restrictedVocab = userProfile.restricted_vocab || [];
  const levelDesc = READING_LEVEL_DESCRIPTORS[readingLevel] || READING_LEVEL_DESCRIPTORS[3];

  const systemPrompt = buildTranslationSystemPrompt({
    constitution,
    levelDesc,
    restrictedVocab,
    readingLevel,
  });

  try {
    const completion = await withRetry(() =>
      groq.chat.completions.create({
        model: groqConfig.translateModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: "json_object" },
      })
    );

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    // If LLM signals simplification failed
    if (parsed.simplified_ok === false) {
      return {
        translated: "Concept too complex for current word list.",
        original: text,
        learn_why: parsed.learn_why || null,
        simplified_ok: false,
      };
    }

    return {
      translated: parsed.translated || text,
      original: text,
      learn_why: parsed.learn_why || null,
      simplified_ok: true,
    };
  } catch (err) {
    console.error("[TRANSLATOR] Translation failed:", err.message);
    // Hard fallback — return original, never crash
    return {
      translated: text,
      original: text,
      learn_why: null,
      simplified_ok: false,
      error: true,
    };
  }
}

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

function buildTranslationSystemPrompt({ constitution, levelDesc, restrictedVocab, readingLevel }) {
  const rules = [];

  // Core mandate — always
  rules.push(`Write for ${levelDesc}`);
  rules.push("Output ZERO filler words. ZERO social padding. ZERO phrases like 'I hope this helps'.");
  rules.push("Be direct and literal. Say exactly what is meant.");

  // Vocabulary restriction
  if (restrictedVocab.length > 0) {
    rules.push(`You MUST only use words from this approved list where possible: [${restrictedVocab.join(", ")}]. If a concept cannot be expressed with this list, set simplified_ok to false.`);
  }

  // Constitution-specific rules
  if (constitution?.language?.literal_mode) {
    rules.push("Replace ALL idioms with their literal meaning. Example: 'kick the bucket' → 'die'.");
    rules.push("Replace ALL metaphors with plain descriptions.");
  }

  if (constitution?.language?.sarcasm_detection === "maximum") {
    rules.push("If the original text contains sarcasm, explain it literally in the translation. Never preserve sarcasm.");
  }

  if (constitution?.language?.emotional_labels) {
    rules.push("Add an emotional label at the start: [TONE: angry] or [TONE: friendly] or [TONE: neutral] etc.");
  }

  if (constitution?.language?.tone_softening) {
    rules.push("Remove any aggressive, rude, or pressuring language. Replace with neutral statements.");
  }

  if (constitution?.language?.max_sentences) {
    rules.push(`Maximum ${constitution.language.max_sentences} sentences in the translation.`);
  }

  if (constitution?.language?.max_words_per_sentence) {
    rules.push(`Maximum ${constitution.language.max_words_per_sentence} words per sentence.`);
  }

  if (constitution?.language?.chunk_into_cards) {
    rules.push("Break the translation into short bullet points. No walls of text.");
  }

  if (constitution?.language?.social_context_labels) {
    rules.push("Add a context label: [CONTEXT: small talk - no reply needed] or [CONTEXT: question - reply expected] etc.");
  }

  if (constitution?.language?.number_to_verbal) {
    rules.push("Convert all numbers to words. Example: 47 → 'about fifty', 3.5 → 'three and a half'.");
  }

  if (constitution?.language?.date_to_relative) {
    rules.push("Convert all dates to relative terms. Example: 'March 15' → 'in 3 days', 'Tuesday' → 'in 2 days'.");
  }

  if (constitution?.language?.content_warnings) {
    rules.push("If the message contains potentially distressing content, add [WARNING: sensitive topic] before the translation.");
  }

  if (constitution?.language?.commitment_detection) {
    rules.push("If the message contains a large commitment or purchase, add [PAUSE: big decision - sleep on it?] at the end.");
  }

  const systemPrompt = `You are a message translator for a neurodivergent user.

RULES (ALL MANDATORY):
${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Respond ONLY with valid JSON. No markdown. No backticks.

JSON format:
{
  "translated": "the translated message text",
  "simplified_ok": true or false (false ONLY if concept truly cannot be expressed in the allowed vocabulary),
  "learn_why": "1-2 sentence plain explanation of WHY the original message was phrased the way it was — social context, tone reason, cultural meaning. Write this for the same reading level as the translation."
}`;

  return systemPrompt;
}

module.exports = {
  translateMessage,
  buildTranslationSystemPrompt,
  READING_LEVEL_DESCRIPTORS,
};
