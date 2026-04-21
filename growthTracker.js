/**
 * growthTracker.js — Vocabulary Growth Engine
 *
 * Manages the full vocabulary lifecycle for special needs users:
 *
 *   1. Word list management (set by helper in Settings)
 *   2. Two modes:
 *      - HARD: strict list only, never goes outside it
 *      - EXPAND: gradual graduation of new words
 *   3. Word frequency tracking (which words appear in messages)
 *   4. Safe graduation (new word must be approved before entering vocab)
 *   5. Regression detection (unused words flagged for review)
 *   6. AAC symbol mapping (words → visual symbol URLs)
 *
 * All data stored in user's Firestore. PRIVACY_ABSOLUTE compliant.
 */

const { getDb } = require("./firebaseSchema");
const admin = require("firebase-admin");

// ============================================================
// VOCAB MODES
// ============================================================

const VOCAB_MODES = {
  HARD: "hard",       // Strict list — never go outside it
  EXPAND: "expand",   // Gradual expansion with approval
};

// ============================================================
// WORD LIST MANAGEMENT
// ============================================================

/**
 * Get the current active vocabulary for a user.
 * @param {string} userId
 * @returns {{ words: string[], mode: string, pending: string[] }}
 */
async function getVocab(userId) {
  const doc = await getDb().collection("users").doc(userId).get();
  if (!doc.exists) return { words: [], mode: VOCAB_MODES.HARD, pending: [] };

  const profile = doc.data();
  return {
    words: profile.restricted_vocab || [],
    mode: profile.vocab_mode || VOCAB_MODES.HARD,
    pending: profile.vocab_pending || [],
  };
}

/**
 * Set the full word list (called from Settings).
 * @param {string} userId
 * @param {string[]} words
 * @param {string} mode — "hard" | "expand"
 */
async function setVocabList(userId, words, mode = VOCAB_MODES.HARD) {
  const normalized = words
    .map((w) => w.toLowerCase().trim())
    .filter(Boolean)
    .filter((w, i, arr) => arr.indexOf(w) === i); // Deduplicate

  await getDb().collection("users").doc(userId).update({
    restricted_vocab: normalized,
    vocab_mode: mode,
    vocab_pending: [],
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Add individual words to the list.
 * @param {string} userId
 * @param {string[]} newWords
 */
async function addWords(userId, newWords) {
  const { words } = await getVocab(userId);
  const normalized = newWords.map((w) => w.toLowerCase().trim()).filter(Boolean);
  const merged = [...new Set([...words, ...normalized])];

  await getDb().collection("users").doc(userId).update({
    restricted_vocab: merged,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Remove words from the list.
 * @param {string} userId
 * @param {string[]} removeWords
 */
async function removeWords(userId, removeWords) {
  const { words } = await getVocab(userId);
  const toRemove = new Set(removeWords.map((w) => w.toLowerCase().trim()));
  const filtered = words.filter((w) => !toRemove.has(w));

  await getDb().collection("users").doc(userId).update({
    restricted_vocab: filtered,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ============================================================
// WORD FREQUENCY TRACKING
// ============================================================

/**
 * Track which words from the active vocab appeared in a message.
 * Builds frequency data for regression detection.
 *
 * @param {string} userId
 * @param {string} messageText
 */
async function trackWordFrequency(userId, messageText) {
  const { words } = await getVocab(userId);
  if (words.length === 0) return;

  const normalized = messageText.toLowerCase();
  const seen = words.filter((w) => normalized.includes(w));
  if (seen.length === 0) return;

  const today = new Date().toISOString().split("T")[0];
  const ref = getDb()
    .collection("users")
    .doc(userId)
    .collection("vocab_frequency")
    .doc(today);

  const existing = await ref.get();
  const freq = existing.exists ? existing.data().freq || {} : {};

  for (const word of seen) {
    freq[word] = (freq[word] || 0) + 1;
  }

  await ref.set({
    date: today,
    freq,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ============================================================
// GRADUATION SYSTEM (EXPAND mode)
// ============================================================

/**
 * Propose a new word for graduation into the active vocab.
 * Word goes into pending state — requires approval.
 *
 * @param {string} userId
 * @param {string} word — the new word to graduate
 * @param {string} context — example sentence where word appeared
 */
async function proposeGraduation(userId, word, context = "") {
  const { words, pending, mode } = await getVocab(userId);

  if (mode === VOCAB_MODES.HARD) return; // Hard mode — no graduation
  if (words.includes(word.toLowerCase())) return; // Already in vocab
  if (pending.includes(word.toLowerCase())) return; // Already pending

  const pendingEntry = {
    word: word.toLowerCase(),
    context: context.substring(0, 200),
    proposed_at: new Date().toISOString(),
  };

  // Store in pending list
  await getDb().collection("users").doc(userId).update({
    vocab_pending: admin.firestore.FieldValue.arrayUnion(pendingEntry.word),
  });

  // Store full pending entry in subcollection
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("vocab_graduation")
    .add({
      ...pendingEntry,
      approved: false,
      rejected: false,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Approve a pending word — moves it into active vocab.
 * @param {string} userId
 * @param {string} word
 * @param {string} graduationId — Firestore doc ID from vocab_graduation
 */
async function approveGraduation(userId, word, graduationId) {
  const normalized = word.toLowerCase().trim();

  // Add to active vocab
  await addWords(userId, [normalized]);

  // Remove from pending
  await getDb().collection("users").doc(userId).update({
    vocab_pending: admin.firestore.FieldValue.arrayRemove(normalized),
  });

  // Mark graduation doc as approved
  if (graduationId) {
    await getDb()
      .collection("users")
      .doc(userId)
      .collection("vocab_graduation")
      .doc(graduationId)
      .update({ approved: true, approved_at: admin.firestore.FieldValue.serverTimestamp() });
  }

  // Track in growth history
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("growth_history")
    .add({
      word: normalized,
      event: "graduated",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Reject a pending word.
 * @param {string} userId
 * @param {string} word
 * @param {string} graduationId
 */
async function rejectGraduation(userId, word, graduationId) {
  const normalized = word.toLowerCase().trim();

  await getDb().collection("users").doc(userId).update({
    vocab_pending: admin.firestore.FieldValue.arrayRemove(normalized),
  });

  if (graduationId) {
    await getDb()
      .collection("users")
      .doc(userId)
      .collection("vocab_graduation")
      .doc(graduationId)
      .update({ rejected: true });
  }
}

// ============================================================
// REGRESSION DETECTION
// ============================================================

/**
 * Detect words in the active vocab that haven't been seen recently.
 * Run weekly. Flags words for review — doesn't auto-remove.
 *
 * @param {string} userId
 * @param {number} dayThreshold — days without use before flagging (default 14)
 * @returns {string[]} words flagged for review
 */
async function detectRegressions(userId, dayThreshold = 14) {
  const { words } = await getVocab(userId);
  if (words.length === 0) return [];

  // Get frequency data for last N days
  const since = new Date();
  since.setDate(since.getDate() - dayThreshold);

  const snapshot = await getDb()
    .collection("users")
    .doc(userId)
    .collection("vocab_frequency")
    .where("date", ">=", since.toISOString().split("T")[0])
    .get();

  // Collect all seen words in the period
  const seenWords = new Set();
  for (const doc of snapshot.docs) {
    const freq = doc.data().freq || {};
    for (const word of Object.keys(freq)) {
      if (freq[word] > 0) seenWords.add(word);
    }
  }

  // Words in vocab but not seen recently
  const regressions = words.filter((w) => !seenWords.has(w));

  // Store regression flags
  if (regressions.length > 0) {
    await getDb()
      .collection("users")
      .doc(userId)
      .collection("growth_history")
      .add({
        event: "regression_detected",
        words: regressions,
        threshold_days: dayThreshold,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  return regressions;
}

// ============================================================
// AAC SYMBOL MAPPING
// ============================================================

/**
 * AAC symbol map.
 * Maps common words to Mulberry Symbol URLs (open-source AAC symbols).
 * Mulberry Symbols: CC BY-SA — free to use.
 * Full set: https://mulberrysymbols.org
 *
 * This is a starter set. Extended via Settings.
 */
const AAC_SYMBOL_BASE = "https://mulberrysymbols.org/symbols/";

const AAC_SYMBOL_MAP = {
  // Core communication
  yes: "yes.svg",
  no: "no.svg",
  help: "help.svg",
  stop: "stop.svg",
  more: "more.svg",
  finished: "finished.svg",
  wait: "wait.svg",
  please: "please.svg",
  thank_you: "thank-you.svg",
  sorry: "sorry.svg",

  // Emotions
  happy: "happy.svg",
  sad: "sad.svg",
  angry: "angry.svg",
  scared: "scared.svg",
  tired: "tired.svg",
  pain: "pain.svg",
  okay: "okay.svg",

  // Basic needs
  water: "water.svg",
  food: "food.svg",
  toilet: "toilet.svg",
  sleep: "sleep.svg",
  home: "home.svg",

  // Social
  hello: "hello.svg",
  goodbye: "goodbye.svg",
  friend: "friend.svg",
  family: "family.svg",

  // Time
  now: "now.svg",
  later: "later.svg",
  today: "today.svg",
  tomorrow: "tomorrow.svg",
};

/**
 * Get AAC symbol URL for a word.
 * @param {string} word
 * @returns {string|null} URL or null if no symbol
 */
function getAACSymbol(word) {
  const normalized = word.toLowerCase().trim().replace(/\s+/g, "_");
  const symbol = AAC_SYMBOL_MAP[normalized];
  return symbol ? `${AAC_SYMBOL_BASE}${symbol}` : null;
}

/**
 * Get AAC symbol map for the user's full vocab list.
 * @param {string[]} words
 * @returns {object} { word: symbolUrl | null }
 */
function getVocabSymbolMap(words) {
  const map = {};
  for (const word of words) {
    map[word] = getAACSymbol(word);
  }
  return map;
}

/**
 * Add custom AAC symbol mapping (helper can add their own).
 * @param {string} userId
 * @param {string} word
 * @param {string} symbolUrl — URL to custom symbol image
 */
async function addCustomSymbol(userId, word, symbolUrl) {
  await getDb()
    .collection("users")
    .doc(userId)
    .collection("aac_symbols")
    .doc(word.toLowerCase().trim())
    .set({
      word: word.toLowerCase().trim(),
      symbol_url: symbolUrl,
      custom: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Get all custom symbols for a user.
 * @param {string} userId
 * @returns {object} { word: symbolUrl }
 */
async function getCustomSymbols(userId) {
  const snapshot = await getDb()
    .collection("users")
    .doc(userId)
    .collection("aac_symbols")
    .get();

  const map = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    map[data.word] = data.symbol_url;
  }
  return map;
}

/**
 * Get full symbol map for a user (built-in + custom).
 * @param {string} userId
 * @param {string[]} vocabWords
 * @returns {object} { word: symbolUrl | null }
 */
async function getFullSymbolMap(userId, vocabWords) {
  const builtIn = getVocabSymbolMap(vocabWords);
  const custom = await getCustomSymbols(userId);

  // Custom overrides built-in
  return { ...builtIn, ...custom };
}

// ============================================================
// PENDING GRADUATIONS (for Settings UI)
// ============================================================

/**
 * Get all pending graduation proposals.
 * @param {string} userId
 * @returns {Array}
 */
async function getPendingGraduations(userId) {
  const snapshot = await getDb()
    .collection("users")
    .doc(userId)
    .collection("vocab_graduation")
    .where("approved", "==", false)
    .where("rejected", "==", false)
    .orderBy("created_at", "desc")
    .get();

  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Get growth history (graduated words over time).
 * @param {string} userId
 * @returns {Array}
 */
async function getGrowthHistory(userId) {
  const snapshot = await getDb()
    .collection("users")
    .doc(userId)
    .collection("growth_history")
    .orderBy("created_at", "desc")
    .limit(100)
    .get();

  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  VOCAB_MODES,
  getVocab,
  setVocabList,
  addWords,
  removeWords,
  trackWordFrequency,
  proposeGraduation,
  approveGraduation,
  rejectGraduation,
  detectRegressions,
  getAACSymbol,
  getVocabSymbolMap,
  getFullSymbolMap,
  addCustomSymbol,
  getCustomSymbols,
  getPendingGraduations,
  getGrowthHistory,
  AAC_SYMBOL_MAP,
};
