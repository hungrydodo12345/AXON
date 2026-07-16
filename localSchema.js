/**
 * localSchema.js — Local Datastore Schema & Initialization
 *
 * Local-first replacement for firebaseSchema.js. All data lives in a
 * single JSON file on disk (see localStore.js) — nothing leaves the
 * machine unless the user explicitly enables sync.
 *
 * Collection structure:
 *   users/{phoneNumber}/
 *     ├── profile          (onboarding data, constitution blend)
 *     ├── contacts/{id}    (bucketed contacts)
 *     ├── messages/{id}    (processed message log)
 *     ├── overrides/{id}   (manual constitution overrides)
 *     └── gargoyle_log/{id}(safety event audit)
 */

const { collection, FieldValue } = require("./localStore");

let initialized = false;

/**
 * Initialize the local datastore (kept for API parity with the old
 * Firebase init call sites — there is no external connection to make).
 * @returns {{ collection: Function }}
 */
function initFirebase() {
  initialized = true;
  return { collection };
}

/**
 * Get the local "db" handle (must call initFirebase first, matching
 * the original Firebase-backed API).
 * @returns {{ collection: Function }}
 */
function getDb() {
  if (!initialized) throw new Error("[LOCAL_STORE FATAL] Not initialized. Call initFirebase() first.");
  return { collection };
}

// ============================================================
// SCHEMA DEFINITIONS (for documentation + validation)
// ============================================================

const SCHEMA = {
  /**
   * users/{phoneNumber}/profile
   * Single document per user. Created at onboarding.
   */
  profile: {
    // --- Identity ---
    phone_number: "",              // string — primary key, E.164 format
    created_at: null,              // timestamp
    updated_at: null,              // timestamp

    // --- Constitution ---
    constitution_blend: {},        // map — e.g. { "adhd": 0.7, "asd": 0.5 }
    auto_detected_profiles: [],    // array — from onboarding questionnaire
    manual_profiles: [],           // array — user-selected overrides
    active_rules: {},              // map — resolved rules from constitutionEngine

    // --- Vocabulary & Reading ---
    restricted_vocab: [],          // array of strings — user's word list
    reading_level: 3,             // integer 1-5
    font_preference: "system",    // string — "system" | "opendyslexic" | "custom"

    // --- Safety ---
    safety_word: "",              // string — Gargoyle trigger
    safety_contacts: [],          // array — { name, phone, email, relationship }
    gargoyle_sensitivity: "normal", // "low" | "normal" | "high" | "maximum"
    care_note: "",                // string — message sent to safety contacts on alert
    trigger_words: [],            // array — user-defined content warning triggers
    push_subscriptions: [],       // array — web push subscription objects
    last_gargoyle_at: null,       // timestamp — for cooldown deduplication

    // --- Contact Buckets ---
    contact_buckets: {
      vip: [],                    // array of phone numbers
      work: [],
      casual: [],
      mute: [],
    },

    // --- BYOK Keys (local, encrypted at rest by the OS keychain in future) ---
    user_keys: {
      GROQ_API_KEY: null,
      RESEND_API_KEY: null,
    },

    // --- Preferences ---
    sensory_settings: {
      grayscale: true,            // boolean — default ON per SENSORY_NEUTRALITY
      brightness: 0.7,            // float 0-1
      animations: false,          // boolean — default OFF
      haptic: false,              // boolean — default OFF
      sound: false,               // boolean — default OFF
      contrast: "normal",         // "low" | "normal" | "high"
    },

    // --- WUPHF ---
    nudge_settings: {
      vip_inactivity_hours: 24,   // int — hours before auto-nudge
      work_inactivity_hours: 48,
    },

    // --- Growth Engine ---
    growth: {
      see_original_enabled: true, // boolean
      learn_why_enabled: true,    // boolean
      vocab_expansion_rate: "slow", // "off" | "slow" | "medium" | "fast"
      vocab_mode: "hard",            // "hard" | "expand"
      vocab_pending: [],             // array — words awaiting graduation approval
      words_learned: [],          // array — words graduated to active vocab
    },
  },

  /**
   * users/{phoneNumber}/contacts/{contactId}
   */
  contact: {
    phone_number: "",
    display_name: "",
    bucket: "casual",             // "vip" | "work" | "casual" | "mute"
    notes: "",                    // user-added context
    last_message_at: null,        // timestamp
    avg_response_time_mins: null, // int — tracked for nudge logic
    relationship_context: "",     // string — "boss" | "friend" | "parent" etc.
  },

  /**
   * users/{phoneNumber}/messages/{messageId}
   */
  message: {
    id: "",
    from: "",                     // sender phone
    to: "",                       // recipient phone
    original_text: "",            // raw message
    translated_text: "",          // after vocabulary shaping
    triage_pile: "",              // "important" | "social" | "casual" | "archive"
    tone_analysis: {},            // { detected_tone, literal_meaning, sarcasm_flag }
    response_options: {
      mcq: [],                   // array of suggested replies
      ai_draft: "",              // AI-generated draft
      manual: true,              // always true — "Something Else" always available
    },
    created_at: null,
    read: false,
    replied: false,
    events_detected: [],         // array — { description, date, calendar_link }
  },

  /**
   * users/{phoneNumber}/overrides/{ruleId}
   * Manual constitution rule overrides.
   */
  override: {
    rule_key: "",                // e.g. "adhd.urgency_timers"
    original_value: null,
    user_value: null,
    reason: "",                  // optional — why user changed it
    created_at: null,
  },

  /**
   * users/{phoneNumber}/gargoyle_log/{eventId}
   * Safety event audit trail. NEVER deleted.
   */
  gargoyle_event: {
    triggered_at: null,          // timestamp
    trigger_type: "",            // "safety_word" | "panic_button" | "auto_detect"
    trigger_source: "",          // "whatsapp" | "pwa" | "api"
    message_context: "",         // sanitized context (no full messages)
    alerts_sent: {
      whatsapp: false,
      email: false,
      web_push: false,
    },
    location: null,              // { lat, lng } if available
    care_note: "",               // pre-set care note from profile
    acknowledged: false,         // safety contact acknowledged
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Create or update a user profile.
 * @param {string} phoneNumber — E.164 format
 * @param {object} profileData — partial profile fields
 */
async function upsertProfile(phoneNumber, profileData) {
  const docRef = getDb().collection("users").doc(phoneNumber);
  const doc = await docRef.get();

  if (doc.exists) {
    await docRef.update({
      ...profileData,
      updated_at: FieldValue.serverTimestamp(),
    });
  } else {
    await docRef.set({
      ...SCHEMA.profile,
      ...profileData,
      phone_number: phoneNumber,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Get a user profile.
 * @param {string} phoneNumber
 * @returns {object|null}
 */
async function getProfile(phoneNumber) {
  const doc = await getDb().collection("users").doc(phoneNumber).get();
  return doc.exists ? doc.data() : null;
}

/**
 * Save a processed message.
 * @param {string} phoneNumber — the user
 * @param {object} messageData
 */
async function saveMessage(phoneNumber, messageData) {
  await getDb()
    .collection("users")
    .doc(phoneNumber)
    .collection("messages")
    .add({
      ...messageData,
      created_at: FieldValue.serverTimestamp(),
    });
}

/**
 * Log a Gargoyle safety event.
 * @param {string} phoneNumber
 * @param {object} eventData
 */
async function logGargoyleEvent(phoneNumber, eventData) {
  await getDb()
    .collection("users")
    .doc(phoneNumber)
    .collection("gargoyle_log")
    .add({
      ...SCHEMA.gargoyle_event,
      ...eventData,
      triggered_at: FieldValue.serverTimestamp(),
    });
}

/**
 * Save a constitution override.
 * @param {string} phoneNumber
 * @param {object} overrideData
 */
async function saveOverride(phoneNumber, overrideData) {
  await getDb()
    .collection("users")
    .doc(phoneNumber)
    .collection("overrides")
    .add({
      ...overrideData,
      created_at: FieldValue.serverTimestamp(),
    });
}

module.exports = {
  initFirebase,
  getDb,
  SCHEMA,
  upsertProfile,
  getProfile,
  saveMessage,
  logGargoyleEvent,
  saveOverride,
};
