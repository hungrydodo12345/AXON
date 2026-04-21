/**
 * constitutionEngine.js — Constitution Blending & Conflict Resolution
 *
 * Responsibilities:
 *   1. Blend multiple profiles into a unified rule set
 *   2. Resolve conflicts using protective hierarchy
 *   3. Validate output against base constitutional protocol
 *   4. Apply user overrides
 *   5. Never weaken the 6 core rules
 *
 * Conflict Resolution Hierarchy (highest wins):
 *   Safety > Sensory Protection > Cognitive Load Reduction > Convenience
 *
 * Protective weight: higher weight = rule wins in conflicts
 */

const { PROFILES, FALLBACK_CONSTITUTION } = require("./constitutions");

// ============================================================
// CORE CONSTITUTIONAL PROTOCOL — IMMUTABLE
// These rules can NEVER be weakened by any profile or override.
// ============================================================
const IMMUTABLE_RULES = {
  privacy_absolute: true,          // no centralized DB
  byok_enforced: true,             // bring your own key
  literal_mandate: true,           // zero filler
  sensory_neutrality_base: true,   // media defaults grayscale + dimmed
  safety_bypass_enabled: true,     // safety word always works
  trinity_reply: true,             // MCQ + AI + Manual always present
  scaffolding_growth: true,        // See Original + Learn Why always available
};

// ============================================================
// CONFLICT RESOLUTION
// ============================================================

/**
 * Conflict resolution hierarchy.
 * When two profiles disagree on a rule, the category with the
 * higher priority wins.
 */
const RULE_CATEGORY = {
  // Safety — always wins
  gargoyle_sensitivity: "safety",
  grounding_available: "safety",
  grounding_always_visible: "safety",
  dissociation_detection: "safety",
  meltdown_detection: "safety",
  crisis_plan_accessible: "safety",
  safe_person_quick_dial: "safety",
  compulsion_detection: "safety",
  content_warnings: "safety",
  content_screening: "safety",
  trigger_word_detection: "safety",

  // Sensory protection — second priority
  grayscale: "sensory",
  brightness: "sensory",
  animations: "sensory",
  sound: "sensory",
  haptic: "sensory",
  auto_play: "sensory",
  transition_speed: "sensory",
  no_sudden_changes: "sensory",
  reduced_motion: "sensory",
  notification_gentleness: "sensory",
  flicker_free: "sensory",

  // Cognitive load — third priority
  max_sentences: "cognitive",
  max_words_per_sentence: "cognitive",
  literal_mode: "cognitive",
  sarcasm_detection: "cognitive",
  urgency_timers: "cognitive",
  read_receipt_hiding: "cognitive",
  pressure_cue_removal: "cognitive",
  chunk_into_cards: "cognitive",
  tone_softening: "cognitive",

  // Convenience — lowest priority
  font_override: "convenience",
  voice_input_primary: "convenience",
  quick_reply_priority: "convenience",
  send_delay: "convenience",
};

const CATEGORY_PRIORITY = {
  safety: 4,
  sensory: 3,
  cognitive: 2,
  convenience: 1,
};

/**
 * Determine which value is "more protective" for a given rule.
 * - Booleans: true is more protective than false
 * - Numbers: lower brightness, fewer sentences, higher sensitivity
 * - Strings with known scales: "maximum" > "high" > "normal" > "low"
 */
const SENSITIVITY_SCALE = { maximum: 4, high: 3, normal: 2, low: 1 };

function moreProtectiveValue(key, valA, valB, weightA, weightB) {
  // Boolean: true wins (more protective = more enabled)
  if (typeof valA === "boolean" && typeof valB === "boolean") {
    // For most booleans, true = more protective
    // Exception: urgency_timers where false = more protective
    const FALSE_IS_PROTECTIVE = ["urgency_timers", "reward_animations", "streak_tracking"];
    if (FALSE_IS_PROTECTIVE.includes(key)) {
      return valA === false ? valA : valB === false ? valB : valA;
    }
    return valA === true ? valA : valB;
  }

  // Sensitivity scale strings
  if (SENSITIVITY_SCALE[valA] !== undefined && SENSITIVITY_SCALE[valB] !== undefined) {
    return SENSITIVITY_SCALE[valA] >= SENSITIVITY_SCALE[valB] ? valA : valB;
  }

  // Numbers: context-dependent
  const LOWER_IS_PROTECTIVE = ["brightness", "max_sentences", "max_words_per_sentence", "re_edit_limit", "reassurance_cap"];
  const HIGHER_IS_PROTECTIVE = ["send_delay", "elevated_send_delay", "min_touch_target", "undo_send_window", "input_delay_tolerance"];

  if (typeof valA === "number" && typeof valB === "number") {
    if (LOWER_IS_PROTECTIVE.includes(key)) {
      return Math.min(valA, valB);
    }
    if (HIGHER_IS_PROTECTIVE.includes(key)) {
      return Math.max(valA, valB);
    }
    // Unknown numeric: use higher weighted profile
    return weightA >= weightB ? valA : valB;
  }

  // Fallback: use higher weighted profile's value
  return weightA >= weightB ? valA : valB;
}

// ============================================================
// BLENDING ENGINE
// ============================================================

/**
 * Blend multiple profiles into a single resolved constitution.
 *
 * @param {object} blend — e.g. { "adhd": 0.7, "anxiety": 0.5, "asd": 0.3 }
 * @param {object|null} userOverrides — manual rule overrides from Firestore
 * @returns {object} resolved rule set
 */
function blendConstitutions(blend, userOverrides = null) {
  const profileIds = Object.keys(blend).filter((id) => PROFILES[id]);

  // If no valid profiles, return fallback
  if (profileIds.length === 0) {
    return { ...FALLBACK_CONSTITUTION.rules };
  }

  // If single profile, just use it directly
  if (profileIds.length === 1) {
    const resolved = deepClone(PROFILES[profileIds[0]].rules);
    return applyOverrides(validateAgainstImmutable(resolved), userOverrides);
  }

  // Multi-profile blending
  const resolved = {
    language: {},
    sensory: {},
    triage: {},
    response: {},
    safety: {},
    growth: {},
  };

  // Collect all rules across all domains
  for (const domain of Object.keys(resolved)) {
    const allKeys = new Set();

    // Gather every rule key from every active profile for this domain
    for (const pid of profileIds) {
      const domainRules = PROFILES[pid].rules[domain] || {};
      for (const key of Object.keys(domainRules)) {
        allKeys.add(key);
      }
    }

    // Resolve each key
    for (const key of allKeys) {
      const candidates = [];

      for (const pid of profileIds) {
        const val = (PROFILES[pid].rules[domain] || {})[key];
        if (val !== undefined) {
          candidates.push({
            profileId: pid,
            value: val,
            blendWeight: blend[pid],
            protectiveWeight: PROFILES[pid].protective_weight,
            effectiveWeight: blend[pid] * PROFILES[pid].protective_weight,
          });
        }
      }

      if (candidates.length === 0) continue;
      if (candidates.length === 1) {
        resolved[domain][key] = candidates[0].value;
        continue;
      }

      // Check if all candidates agree
      const allSame = candidates.every(
        (c) => JSON.stringify(c.value) === JSON.stringify(candidates[0].value)
      );
      if (allSame) {
        resolved[domain][key] = candidates[0].value;
        continue;
      }

      // Conflict! Resolve using RULE_CATEGORY priority first,
      // then protective weight as tiebreaker.
      // This ensures safety rules always beat sensory, etc.
      const ruleCategory = RULE_CATEGORY[key];
      const rulePriority = ruleCategory ? (CATEGORY_PRIORITY[ruleCategory] || 0) : 0;

      // Sort candidates by: category priority boost → effective weight
      candidates.sort((a, b) => {
        // Both get same category boost, so it only matters for
        // comparing against OTHER keys. Within same key, use weight.
        return b.effectiveWeight - a.effectiveWeight;
      });

      // Fold ALL candidates through moreProtectiveValue, not just top 2.
      // Start with most-weighted candidate, merge in each subsequent one.
      let resolvedValue = candidates[0].value;
      let resolvedWeight = candidates[0].effectiveWeight;

      for (let i = 1; i < candidates.length; i++) {
        resolvedValue = moreProtectiveValue(
          key,
          resolvedValue,
          candidates[i].value,
          resolvedWeight,
          candidates[i].effectiveWeight
        );
        // Keep the higher weight for next comparison
        resolvedWeight = Math.max(resolvedWeight, candidates[i].effectiveWeight);
      }

      // If this key belongs to a high-priority category (safety/sensory),
      // always prefer the more protective outcome regardless of weight.
      if (rulePriority >= CATEGORY_PRIORITY.sensory) {
        // Re-resolve with forced protective preference
        resolvedValue = candidates.reduce((acc, c) => {
          return moreProtectiveValue(key, acc, c.value, Infinity, 0);
        }, candidates[0].value);
      }

      resolved[domain][key] = resolvedValue;
    }
  }

  return applyOverrides(validateAgainstImmutable(resolved), userOverrides);
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Ensure no profile or blend weakens immutable rules.
 * @param {object} rules — resolved rule set
 * @returns {object} validated rules
 */
function validateAgainstImmutable(rules) {
  // SENSORY_NEUTRALITY: grayscale must default true
  if (rules.sensory) {
    if (rules.sensory.grayscale === false) rules.sensory.grayscale = true;
    if (rules.sensory.brightness > 0.8) rules.sensory.brightness = 0.7;
  }

  // SAFETY_BYPASS: gargoyle sensitivity can never be "off" or "none"
  if (rules.safety) {
    if (!rules.safety.gargoyle_sensitivity || rules.safety.gargoyle_sensitivity === "off") {
      rules.safety.gargoyle_sensitivity = "normal";
    }
  }

  // SCAFFOLDING_GROWTH: see_original must be available (even if default off)
  // Note: PTSD sets see_original to false by default, but it's still *available* in UI
  if (rules.growth) {
    // We add a separate flag to distinguish "default off" vs "unavailable"
    rules.growth._see_original_available = true;
    rules.growth._learn_why_available = true;
  }

  return rules;
}

/**
 * Apply user manual overrides.
 * Overrides can NEVER weaken immutable rules.
 * @param {object} rules
 * @param {object|null} overrides — { "domain.key": value }
 * @returns {object}
 */
function applyOverrides(rules, overrides) {
  if (!overrides) return rules;

  for (const [path, value] of Object.entries(overrides)) {
    const [domain, key] = path.split(".");
    if (!domain || !key || !rules[domain]) continue;

    // Block override if it would weaken immutable rules
    if (domain === "sensory" && key === "grayscale" && value === false) continue;
    if (domain === "safety" && key === "gargoyle_sensitivity" && value === "off") continue;

    rules[domain][key] = value;
  }

  return rules;
}

// ============================================================
// AUTO-DETECTION (from onboarding answers)
// ============================================================

/**
 * Map onboarding questionnaire answers to a profile blend.
 * @param {object} answers — keyed by question ID from onboardingQuestions.js
 * @returns {object} blend — e.g. { "adhd": 0.7, "asd": 0.5 }
 */
function autoDetectBlend(answers) {
  const scores = {};

  // Initialize all profiles at 0
  for (const pid of Object.keys(PROFILES)) {
    scores[pid] = 0;
  }

  // Score each answer against profile indicators
  const ANSWER_WEIGHTS = getAnswerWeights();

  for (const [questionId, answer] of Object.entries(answers)) {
    const weights = ANSWER_WEIGHTS[questionId];
    if (!weights) continue;

    const answerWeights = weights[answer];
    if (!answerWeights) continue;

    for (const [profileId, weight] of Object.entries(answerWeights)) {
      scores[profileId] = (scores[profileId] || 0) + weight;
    }
  }

  // Normalize scores to 0-1 range
  const maxScore = Math.max(...Object.values(scores), 1);
  const blend = {};

  for (const [pid, score] of Object.entries(scores)) {
    const normalized = score / maxScore;
    // Only include profiles with meaningful signal (>0.2)
    if (normalized > 0.2) {
      blend[pid] = Math.round(normalized * 100) / 100;
    }
  }

  // If nothing detected, return empty (will trigger fallback)
  return Object.keys(blend).length > 0 ? blend : {};
}

/**
 * Answer weight mappings.
 * Maps questionId → answer → { profileId: weight }
 * See onboardingQuestions.js for question definitions.
 */
function getAnswerWeights() {
  return {
    comm_style: {
      literal: { asd: 3, nvld: 1 },
      brief: { adhd: 3 },
      careful: { anxiety: 3, ocd: 1 },
      visual: { dyslexia: 2, nvld: 1 },
    },
    reading_comfort: {
      short_simple: { dyslexia: 3, adhd: 1 },
      audio_preferred: { dyslexia: 2, dyspraxia: 1 },
      normal: {},
      detailed_ok: {},
    },
    social_cues: {
      hard_to_read: { asd: 3, nvld: 3 },
      sometimes_miss: { asd: 1, nvld: 2 },
      mostly_fine: {},
      easy: {},
    },
    sensory_needs: {
      very_sensitive: { spd: 3, asd: 2 },
      somewhat: { spd: 2, asd: 1 },
      not_really: {},
      enjoy_stimulation: {},
    },
    organization: {
      very_hard: { adhd: 3 },
      need_reminders: { adhd: 2 },
      mostly_ok: {},
      very_organized: { ocd: 1 },
    },
    numbers_comfort: {
      very_hard: { dyscalculia: 3 },
      need_help: { dyscalculia: 2 },
      ok: {},
      easy: {},
    },
    motor_skills: {
      clumsy_often: { dyspraxia: 3 },
      sometimes: { dyspraxia: 1 },
      fine: {},
    },
    repetitive_thoughts: {
      constant: { ocd: 3 },
      often: { ocd: 2 },
      sometimes: { ocd: 1, anxiety: 1 },
      rarely: {},
    },
    mood_swings: {
      extreme_cycles: { bipolar: 3 },
      noticeable: { bipolar: 2 },
      mild: { bipolar: 1 },
      stable: {},
    },
    anxiety_level: {
      constant: { anxiety: 3, ptsd: 1 },
      social_mainly: { anxiety: 3 },
      occasional: { anxiety: 1 },
      rare: {},
    },
    trauma_history: {
      significant: { ptsd: 3 },
      some: { ptsd: 2 },
      mild: { ptsd: 1 },
      none: {},
    },
    tic_experience: {
      frequent: { tourettes: 3 },
      occasional: { tourettes: 2 },
      rare: { tourettes: 1 },
      none: {},
    },
  };
}

// ============================================================
// UTILITIES
// ============================================================

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Get the resolved constitution for a user.
 * This is the main entry point used by other modules.
 *
 * @param {object} userProfile — from Firestore
 * @returns {object} fully resolved, validated rule set
 */
function resolveConstitution(userProfile) {
  if (!userProfile) {
    return FALLBACK_CONSTITUTION.rules;
  }

  const blend = userProfile.constitution_blend || {};
  const overrides = {};

  // Convert override docs to flat map
  // (caller should pass these from Firestore overrides subcollection)
  if (userProfile._overrides) {
    for (const ov of userProfile._overrides) {
      overrides[ov.rule_key] = ov.user_value;
    }
  }

  return blendConstitutions(blend, Object.keys(overrides).length > 0 ? overrides : null);
}

module.exports = {
  blendConstitutions,
  validateAgainstImmutable,
  applyOverrides,
  autoDetectBlend,
  resolveConstitution,
  IMMUTABLE_RULES,
};
