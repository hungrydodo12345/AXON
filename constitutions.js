/**
 * constitutions.js — Neurodivergent Profile Constitutions
 *
 * Each profile defines rules across 6 domains:
 *   - language    (how text is processed)
 *   - sensory     (UI presentation)
 *   - triage      (message prioritization)
 *   - response    (reply generation)
 *   - safety      (Gargoyle sensitivity)
 *   - growth      (learning scaffolding)
 *
 * Rules are keyed for conflict resolution in constitutionEngine.js.
 * Higher `protective_weight` = wins in blending conflicts.
 */

const PROFILES = {

  // ============================================================
  // 1. AUTISM (ASD)
  // ============================================================
  asd: {
    id: "asd",
    label: "Autism (ASD)",
    description: "Literal communication, routine consistency, sensory protection",
    protective_weight: 9,

    rules: {
      language: {
        literal_mode: true,               // zero idioms, metaphors, sarcasm in output
        sarcasm_detection: "maximum",     // always flag + explain sarcasm
        idiom_translation: true,          // replace idioms with literal meaning
        emotional_labels: true,           // "This person seems [emotion]" on every msg
        max_ambiguity: 0,                 // no ambiguous phrasing in output
        metaphor_replacement: true,       // replace metaphors with plain language
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        animations: false,
        sound: false,
        haptic: false,
        layout_consistency: "strict",     // UI never rearranges
        font_override: null,             // uses user preference
        transition_speed: 0,             // instant transitions, no motion
      },
      triage: {
        routine_priority: true,           // routine messages get consistent placement
        change_alerts: true,             // flag any schedule/routine changes as important
        group_compression: "maximum",     // groups → 1 sentence
      },
      response: {
        social_scripts: true,            // provide social context scripts
        emoji_translation: true,         // explain emoji meanings
        tone_mirror_feedback: true,      // show how reply will be perceived
        explicit_intent: true,           // "You are saying: [intent]" on drafts
      },
      safety: {
        gargoyle_sensitivity: "normal",
        meltdown_detection: true,        // detect overwhelm patterns
        cooldown_suggestion: true,       // suggest breaks when overloaded
      },
      growth: {
        social_cue_explanations: true,   // "Learn Why" for social nuances
        see_original: true,
        vocab_expansion: "slow",
      },
    },
  },

  // ============================================================
  // 2. ADHD
  // ============================================================
  adhd: {
    id: "adhd",
    label: "ADHD",
    description: "Ultra-brief summaries, task extraction, time awareness",
    protective_weight: 7,

    rules: {
      language: {
        max_sentences: 2,                // summary cap
        action_item_extraction: true,    // auto-detect tasks
        time_estimation: true,           // "Reply needed in ~2hrs"
        brevity_enforcement: "strict",   // no padding, no filler
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        animations: false,
        reward_animations: false,        // no dopamine hooks
        streak_tracking: false,          // no gamification
        visual_clutter: "minimal",       // clean UI
      },
      triage: {
        urgency_timers: true,            // show response deadlines
        priority_badges: true,           // visual urgency markers
        task_checklist: true,            // surface action items as checklist
        unread_counter: "neutral",       // "3 unreplied" not "3 WAITING!"
      },
      response: {
        quick_reply_priority: true,      // MCQ chips prominent
        draft_length_cap: 3,             // max 3 sentences in AI draft
        focus_mode: true,                // one message at a time option
      },
      safety: {
        gargoyle_sensitivity: "normal",
        hyperfocus_break_reminder: true, // nudge after long sessions
      },
      growth: {
        time_management_tips: true,
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 3. DYSLEXIA
  // ============================================================
  dyslexia: {
    id: "dyslexia",
    label: "Dyslexia",
    description: "Reading support, font accessibility, audio options",
    protective_weight: 8,

    rules: {
      language: {
        max_words_per_sentence: 12,      // short sentences only
        reading_level_cap: 3,            // Grade 3 unless user raises
        chunk_into_cards: true,          // no walls of text
        tts_available: true,             // text-to-speech on every message
        syllable_simplification: true,   // prefer shorter words
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        font_override: "opendyslexic",   // default to OpenDyslexic
        line_spacing: 1.8,              // increased line height
        letter_spacing: "wide",         // increased letter spacing
        background_tint: "cream",       // off-white background option
      },
      triage: {
        visual_pile_icons: true,         // icon-based triage, not text labels
        audio_summaries: true,           // spoken pile summaries
      },
      response: {
        voice_input_primary: true,       // speech-to-text as default input
        spelling_forgiveness: "maximum", // aggressive autocorrect
        word_prediction: true,           // predictive text
      },
      safety: {
        gargoyle_sensitivity: "normal",
      },
      growth: {
        word_highlighting: true,         // highlight new/complex words
        see_original: true,
        vocab_expansion: "slow",
      },
    },
  },

  // ============================================================
  // 4. ANXIETY / SOCIAL ANXIETY
  // ============================================================
  anxiety: {
    id: "anxiety",
    label: "Anxiety / Social Anxiety",
    description: "Tone softening, pressure removal, reassurance support",
    protective_weight: 8,

    rules: {
      language: {
        tone_softening: true,            // neutralize perceived hostility
        reassurance_hints: true,         // "They're probably not mad" (toggleable)
        catastrophe_dampening: true,     // reframe worst-case language
        certainty_language: true,        // avoid "maybe" "might be upset"
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        animations: false,
        notification_gentleness: "maximum", // subtle, non-alarming notifications
        urgency_visual_removal: true,    // no red badges, no countdown timers
      },
      triage: {
        urgency_timers: false,           // NO time pressure
        read_receipt_hiding: true,       // hide read receipts
        pressure_cue_removal: true,      // no "seen" indicators
        queue_not_pile: true,            // "messages to look at" not "unread pile"
      },
      response: {
        confidence_meter: true,          // "This reply sounds friendly ✓"
        tone_preview: true,              // show how recipient might perceive reply
        send_delay_option: true,         // optional delay before sending
        undo_send_window: 10,            // 10 second undo window
      },
      safety: {
        gargoyle_sensitivity: "high",    // lower threshold for panic detection
        grounding_available: true,       // "You are safe" accessible anytime
        breathing_exercise: true,        // quick breathing guide accessible
      },
      growth: {
        anxiety_psychoed: true,          // "Learn Why" explains anxiety patterns
        see_original: true,
        vocab_expansion: "slow",
      },
    },
  },

  // ============================================================
  // 5. DYSCALCULIA
  // ============================================================
  dyscalculia: {
    id: "dyscalculia",
    label: "Dyscalculia",
    description: "Number translation, visual math, relative time",
    protective_weight: 6,

    rules: {
      language: {
        number_to_verbal: true,          // "47" → "about fifty"
        date_to_relative: true,          // "March 15" → "in 3 days"
        time_to_relative: true,          // "14:30" → "2 and a half hours from now"
        fraction_simplification: true,   // "3/8" → "less than half"
        percentage_to_visual: true,      // "73%" → progress bar
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        number_display: "verbal",        // words not digits where possible
        progress_bars_over_numbers: true,
      },
      triage: {
        // standard triage, no special modifications
      },
      response: {
        number_input_helper: true,       // calculator-style input for numbers
        date_picker_visual: true,        // visual calendar, not typed dates
      },
      safety: {
        gargoyle_sensitivity: "normal",
      },
      growth: {
        number_sense_tips: true,
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 6. DYSPRAXIA
  // ============================================================
  dyspraxia: {
    id: "dyspraxia",
    label: "Dyspraxia",
    description: "Motor-friendly UI, large targets, voice-first input",
    protective_weight: 7,

    rules: {
      language: {
        // no special language modifications
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        min_touch_target: 48,            // 48px minimum tap targets
        no_drag: true,                   // no drag-and-drop
        no_swipe: true,                  // no swipe gestures
        no_double_tap: true,             // no double-tap actions
        tap_forgiveness: "high",         // generous touch zones
      },
      triage: {
        // standard triage
      },
      response: {
        voice_input_primary: true,       // speech-to-text default
        large_buttons: true,             // oversized MCQ chips
        typing_assistance: true,         // predictive + forgiving input
      },
      safety: {
        gargoyle_sensitivity: "normal",
        large_panic_button: true,        // extra-large safety button
      },
      growth: {
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 7. TOURETTE'S / TIC DISORDERS
  // ============================================================
  tourettes: {
    id: "tourettes",
    label: "Tourette's / Tic Disorders",
    description: "Input forgiveness, calm pacing, no time pressure",
    protective_weight: 6,

    rules: {
      language: {
        // no special language modifications
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        animations: false,
        transition_speed: "slow",        // calm, slow transitions
        no_rapid_changes: true,          // no sudden UI updates
        flicker_free: true,              // no flickering elements
      },
      triage: {
        urgency_timers: false,           // no time pressure
      },
      response: {
        keystroke_dedup: true,           // auto-correct repeated keystrokes
        input_delay_tolerance: "high",   // long timeout before input commits
        no_time_pressure_ui: true,       // no countdown, no "typing..."
        voice_input_available: true,     // voice as alternative
      },
      safety: {
        gargoyle_sensitivity: "normal",
      },
      growth: {
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 8. OCD
  // ============================================================
  ocd: {
    id: "ocd",
    label: "OCD",
    description: "Anti-loop protections, good-enough nudges, check limits",
    protective_weight: 8,

    rules: {
      language: {
        certainty_language: true,        // avoid ambiguous phrasing
        completeness_signals: true,      // "This covers everything needed"
        no_open_loops: true,             // close every thread explicitly
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        symmetrical_layout: true,        // visually balanced UI
        completion_indicators: true,     // clear "done" states
      },
      triage: {
        single_confirmation: true,       // one confirm, then done
        no_re_sort: false,              // don't let user re-sort obsessively
      },
      response: {
        good_enough_nudge: true,         // "Your reply is clear. Send?"
        re_edit_limit: 3,               // after 3 edits, suggest sending
        re_read_collapse: true,          // collapse already-reviewed messages
        reassurance_cap: 2,             // max 2 reassurance requests per message
        single_send_confirm: true,       // one "Send?" not "Are you sure?"
      },
      safety: {
        gargoyle_sensitivity: "normal",
        compulsion_detection: true,      // detect checking loops
        gentle_redirect: true,           // "You've already checked this"
      },
      growth: {
        erp_psychoed: true,             // "Learn Why" explains ERP concepts
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 9. PTSD / C-PTSD
  // ============================================================
  ptsd: {
    id: "ptsd",
    label: "PTSD / C-PTSD",
    description: "Content warnings, grounding, maximum safety sensitivity",
    protective_weight: 10,              // highest protective weight

    rules: {
      language: {
        content_warnings: true,          // CW before sensitive topics
        trigger_word_detection: true,    // user-defined trigger word list
        tone_softening: true,            // neutralize aggressive language
        gradual_reveal: true,            // show summary first, full on tap
      },
      sensory: {
        grayscale: true,
        brightness: 0.6,                // slightly dimmer default
        animations: false,
        sound: false,
        no_sudden_changes: true,         // no abrupt UI shifts
        predictable_layout: true,        // consistent, familiar UI
      },
      triage: {
        content_screening: true,         // screen for distressing content
        delayed_distressing: true,       // option to delay upsetting messages
        time_window_delivery: true,      // deliver only during safe hours
      },
      response: {
        grounding_always_visible: true,  // "You are safe. You are here." always accessible
        safe_exit: true,                 // one-tap exit from any screen
        no_forced_interaction: true,     // never require reply
      },
      safety: {
        gargoyle_sensitivity: "maximum", // lowest threshold
        grounding_prompt: "You are safe. You are here. This is [current time].",
        safe_person_quick_dial: true,    // one-tap call safety contact
        dissociation_detection: true,    // detect disengagement patterns
      },
      growth: {
        trauma_informed_psychoed: true,
        see_original: false,             // default OFF — opt-in only
        vocab_expansion: "off",          // stability over growth
      },
    },
  },

  // ============================================================
  // 10. BIPOLAR DISORDER
  // ============================================================
  bipolar: {
    id: "bipolar",
    label: "Bipolar Disorder",
    description: "Mood monitoring, send delays, commitment detection",
    protective_weight: 8,

    rules: {
      language: {
        neutral_tone_enforcement: true,  // no UI energy matching
        commitment_detection: true,      // flag impulsive commitments
        spending_language_flag: true,    // "I'll buy 10" → soft pause
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        animations: false,
        energy_neutral_ui: true,         // no exclamation marks, no hype
        consistent_color_temp: true,     // no warm/cool shifts
      },
      triage: {
        // standard triage
      },
      response: {
        send_delay: 30,                  // 30-second delay on all sends
        elevated_send_delay: 120,        // 2-min delay during flagged periods
        mood_journal_prompt: true,       // optional, non-intrusive
        impulsivity_check: true,         // "Sleep on it?" for big commitments
      },
      safety: {
        gargoyle_sensitivity: "high",
        mood_pattern_tracking: true,     // local-only mood trend data
        crisis_plan_accessible: true,    // user-defined crisis plan quick access
      },
      growth: {
        mood_psychoed: true,
        see_original: true,
        vocab_expansion: "slow",
      },
    },
  },

  // ============================================================
  // 11. SENSORY PROCESSING DISORDER (SPD)
  // ============================================================
  spd: {
    id: "spd",
    label: "Sensory Processing Disorder",
    description: "Full sensory control panel, zero auto-play, minimal stimulation",
    protective_weight: 9,

    rules: {
      language: {
        // no special language modifications
      },
      sensory: {
        grayscale: true,
        brightness: 0.6,
        animations: false,
        sound: false,
        haptic: false,
        auto_play: false,                // NEVER auto-play media
        sensory_control_panel: true,     // full brightness/contrast/saturation/font controls
        notification_visual_only: true,  // no sound, no vibration
        media_preview: "thumbnail",      // tiny preview, not full-size
        reduced_motion: true,
      },
      triage: {
        media_strip: true,              // strip media from summaries
        text_only_default: true,         // text-only mode by default
      },
      response: {
        minimal_ui: true,               // stripped-down interface
        no_auto_expand: true,            // nothing opens automatically
      },
      safety: {
        gargoyle_sensitivity: "normal",
        sensory_overload_detection: true, // detect rapid message volume
        auto_mute_suggestion: true,      // suggest muting during overload
      },
      growth: {
        sensory_psychoed: true,
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },

  // ============================================================
  // 12. NONVERBAL LEARNING DISABILITY (NVLD)
  // ============================================================
  nvld: {
    id: "nvld",
    label: "Nonverbal Learning Disability",
    description: "Social context labeling, emoji translation, social scripts",
    protective_weight: 7,

    rules: {
      language: {
        social_context_labels: true,     // "This is small talk, no reply needed"
        emoji_to_text: true,             // translate emojis to words
        image_description: true,         // describe images in text
        subtext_explanation: true,       // explain what's implied
        intent_labeling: true,           // "They are asking you to..."
      },
      sensory: {
        grayscale: true,
        brightness: 0.7,
        visual_hierarchy_clear: true,    // strong visual structure
      },
      triage: {
        social_obligation_label: true,   // "Reply expected" vs "No reply needed"
        relationship_context: true,      // show relationship type on every message
      },
      response: {
        social_scripts: true,            // step-by-step reply templates
        reply_necessity_indicator: true, // "You should reply" / "Optional"
        social_rule_hints: true,         // "It's polite to acknowledge this"
        multiple_interpretation: true,   // show possible meanings
      },
      safety: {
        gargoyle_sensitivity: "normal",
      },
      growth: {
        social_skill_building: true,     // progressive social cue learning
        see_original: true,
        vocab_expansion: "medium",
      },
    },
  },
};

// ============================================================
// FALLBACK CONSTITUTION — used when no profile is selected
// Applies the most protective rule from ALL profiles.
// ============================================================
const FALLBACK_CONSTITUTION = {
  id: "_fallback",
  label: "Safe Default",
  description: "Most protective rules from all profiles. Used when detection fails or user skips onboarding.",
  rules: {
    language: {
      literal_mode: true,
      sarcasm_detection: "maximum",
      max_sentences: 2,
      max_words_per_sentence: 12,
      emotional_labels: true,
      tone_softening: true,
      content_warnings: true,
    },
    sensory: {
      grayscale: true,
      brightness: 0.6,
      animations: false,
      sound: false,
      haptic: false,
      auto_play: false,
      min_touch_target: 48,
    },
    triage: {
      urgency_timers: false,
      read_receipt_hiding: true,
      content_screening: true,
    },
    response: {
      grounding_always_visible: true,
      confidence_meter: true,
      voice_input_available: true,
    },
    safety: {
      gargoyle_sensitivity: "high",
      grounding_available: true,
    },
    growth: {
      see_original: true,
      learn_why: true,
      vocab_expansion: "slow",
    },
  },
};

/**
 * Get a profile by ID.
 * @param {string} profileId
 * @returns {object|null}
 */
function getProfile(profileId) {
  return PROFILES[profileId] || null;
}

/**
 * Get all profile IDs.
 * @returns {string[]}
 */
function getAllProfileIds() {
  return Object.keys(PROFILES);
}

/**
 * Get the fallback constitution.
 * @returns {object}
 */
function getFallback() {
  return FALLBACK_CONSTITUTION;
}

module.exports = {
  PROFILES,
  FALLBACK_CONSTITUTION,
  getProfile,
  getAllProfileIds,
  getFallback,
};
