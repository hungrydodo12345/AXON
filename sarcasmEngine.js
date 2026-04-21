/**
 * sarcasmEngine.js — Sarcasm & Tone Literalizer (Phase 3)
 *
 * Detects and explains:
 *   - Sarcasm
 *   - Passive aggression
 *   - Implied subtext
 *   - Cultural idioms
 *   - Ambiguous phrasing
 *
 * Always returns:
 *   - literal_meaning: what was actually meant
 *   - tone_label: detected emotional tone
 *   - explanation: plain "Learn Why" text
 *   - flags: array of detected patterns
 *
 * Constitutional compliance:
 *   - ASD/NVLD profiles: sarcasm_detection at "maximum"
 *   - LITERAL_MANDATE: never preserve ambiguity in output
 */

const Groq = require("groq-sdk");
const { getGroqConfig } = require("./config");

// ============================================================
// TONE LABELS
// ============================================================

const TONE_LABELS = {
  friendly: "This person seems friendly.",
  neutral: "This message has no strong emotion.",
  angry: "This person seems angry or frustrated.",
  sad: "This person seems sad or upset.",
  anxious: "This person seems worried.",
  sarcastic: "This message uses sarcasm. The real meaning is the opposite of what is written.",
  passive_aggressive: "This message sounds polite but has a hidden negative meaning.",
  urgent: "This person needs something quickly.",
  dismissive: "This person seems uninterested or is brushing something off.",
  grateful: "This person is saying thank you.",
  confused: "This person is unsure or asking for help.",
};

// ============================================================
// FAST PRE-SCREEN (no LLM)
// ============================================================

// Common sarcasm patterns — if matched, flag for LLM deep analysis
const SARCASM_PATTERNS = [
  /\boh great\b/i,
  /\bsure jan\b/i,
  /\byeah right\b/i,
  /\bwhatever\b/i,
  /\bnot like\b/i,
  /\bclearly\b/i,
  /\bobviously\b/i,
  /thanks (a lot|so much|for nothing)/i,
  /\bfine\b/i,
  /\bno worries\b/i,
  /must be nice/i,
  /good for you/i,
  /wow thanks/i,
];

const PASSIVE_AGGRESSIVE_PATTERNS = [
  /\bif you say so\b/i,
  /\bif that's what you think\b/i,
  /\bi guess\b/i,
  /\bdo whatever you want\b/i,
  /\bit's fine\b/i,
  /\bdon't worry about it\b/i,
  /\bforgot again\b/i,
  /\bas usual\b/i,
  /\bno it's fine\b/i,
];

/**
 * Fast pre-screen to decide if LLM analysis is needed.
 * @param {string} text
 * @returns {{ needsLLM: boolean, flags: string[] }}
 */
function prescreenText(text) {
  const flags = [];

  for (const pattern of SARCASM_PATTERNS) {
    if (pattern.test(text)) {
      flags.push("possible_sarcasm");
      break;
    }
  }

  for (const pattern of PASSIVE_AGGRESSIVE_PATTERNS) {
    if (pattern.test(text)) {
      flags.push("possible_passive_aggression");
      break;
    }
  }

  // Short messages with punctuation extremes (!)
  if (text.split("!").length > 3) flags.push("high_exclamation");

  // ALL CAPS words
  if (/\b[A-Z]{3,}\b/.test(text)) flags.push("caps_emphasis");

  return {
    needsLLM: flags.length > 0,
    flags,
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

/**
 * Analyze a message for tone, sarcasm, and subtext.
 *
 * @param {object} params
 * @param {string} params.text — original message
 * @param {object} params.constitution — resolved rules
 * @param {object} params.userProfile — for reading level
 * @param {object|null} params.userKeys — BYOK
 * @returns {object} { tone_label, literal_meaning, explanation, flags, sarcasm_detected, needs_explanation }
 */
async function analyzeMessage({ text, constitution, userProfile, userKeys = null }) {
  const sensitivity = constitution?.language?.sarcasm_detection || "normal";
  const readingLevel = userProfile.reading_level || 3;

  // Pre-screen first — skip LLM if not needed and sensitivity is not maximum
  const prescreen = prescreenText(text);
  if (!prescreen.needsLLM && sensitivity !== "maximum") {
    return buildNeutralResult(text, prescreen.flags);
  }

  // LLM deep analysis
  try {
    const groqConfig = getGroqConfig(userKeys);
    const groq = new Groq({ apiKey: groqConfig.apiKey });

    const systemPrompt = buildSarcasmSystemPrompt(sensitivity, readingLevel);

    const completion = await groq.chat.completions.create({
      model: groqConfig.translateModel, // 70B for nuance
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return {
      tone_label: TONE_LABELS[parsed.tone] || parsed.tone_label || TONE_LABELS.neutral,
      tone_key: parsed.tone || "neutral",
      literal_meaning: parsed.literal_meaning || text,
      explanation: parsed.explanation || null,
      flags: [...prescreen.flags, ...(parsed.flags || [])],
      sarcasm_detected: parsed.sarcasm_detected || false,
      passive_aggression_detected: parsed.passive_aggression_detected || false,
      needs_explanation: parsed.needs_explanation || false,
    };
  } catch (err) {
    console.error("[SARCASM ENGINE] Analysis failed:", err.message);
    return buildNeutralResult(text, prescreen.flags);
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSarcasmSystemPrompt(sensitivity, readingLevel) {
  const strictness = sensitivity === "maximum"
    ? "Analyze EVERY message for tone, even if it seems normal. Flag ANY ambiguity."
    : sensitivity === "high"
    ? "Analyze carefully. Flag sarcasm and passive aggression when detected."
    : "Only flag clear, obvious sarcasm or aggression.";

  return `You are a tone and sarcasm analyzer for a neurodivergent user who has difficulty reading social cues.

Sensitivity level: ${strictness}

Respond ONLY with valid JSON. No markdown. No backticks.

JSON format:
{
  "tone": one of: "friendly" | "neutral" | "angry" | "sad" | "anxious" | "sarcastic" | "passive_aggressive" | "urgent" | "dismissive" | "grateful" | "confused",
  "tone_label": "Plain sentence describing the tone for a Grade ${readingLevel} reader",
  "sarcasm_detected": boolean,
  "passive_aggression_detected": boolean,
  "literal_meaning": "What this message ACTUALLY means, literally and plainly. Write for Grade ${readingLevel} reading level.",
  "needs_explanation": boolean — true if there is social subtext the user might miss,
  "explanation": "If needs_explanation is true: 1-2 plain sentences explaining WHY this message was written this way. What is the sender really feeling or wanting? Write for Grade ${readingLevel} reading level.",
  "flags": array of strings — any of: "sarcasm" | "passive_aggression" | "ambiguity" | "implied_urgency" | "cultural_idiom" | "emotional_subtext"
}`;
}

// ============================================================
// FALLBACK
// ============================================================

function buildNeutralResult(text, flags = []) {
  return {
    tone_label: TONE_LABELS.neutral,
    tone_key: "neutral",
    literal_meaning: text,
    explanation: null,
    flags,
    sarcasm_detected: false,
    passive_aggression_detected: false,
    needs_explanation: false,
  };
}

module.exports = {
  analyzeMessage,
  prescreenText,
  TONE_LABELS,
};
