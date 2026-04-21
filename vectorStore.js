/**
 * vectorStore.js — Firebase-based Vector Storage & Similarity Search
 *
 * No external vector DB. All embeddings stored in user's Firestore.
 * Fully BYOK compliant — zero new vendors.
 *
 * Architecture:
 *   - Embeddings generated via Groq embedding endpoint
 *   - Fallback: deterministic hash-based pseudo-embedding (offline)
 *   - Stored as float arrays in Firestore
 *   - Similarity: cosine similarity, pre-filtered by metadata
 *
 * Collections:
 *   users/{phone}/embeddings/{id}       — message vectors
 *   users/{phone}/contact_memory/{phone} — per-contact vectors
 *   users/{phone}/patterns/{date}       — daily pattern snapshots
 */

const Groq = require("groq-sdk");
const { getDb } = require("./firebaseSchema");
const { getGroqConfig } = require("./config");
const admin = require("firebase-admin");

// ============================================================
// EMBEDDING GENERATION
// ============================================================

/**
 * Generate an embedding vector for a text string.
 * Uses Groq's embedding endpoint. Falls back to hash-based if unavailable.
 *
 * @param {string} text
 * @param {object|null} userKeys — BYOK
 * @returns {number[]} embedding vector
 */
async function generateEmbedding(text, userKeys = null) {
  try {
    const groqConfig = getGroqConfig(userKeys);
    const groq = new Groq({ apiKey: groqConfig.apiKey });

    const response = await groq.embeddings.create({
      model: "nomic-embed-text-v1_5",
      input: text.substring(0, 2048), // Groq embedding token limit
    });

    return response.data[0].embedding;
  } catch (err) {
    console.warn("[VECTOR] Groq embedding failed, using fallback:", err.message);
    return hashEmbedding(text);
  }
}

/**
 * Deterministic hash-based pseudo-embedding fallback.
 * 128-dimensional. Not semantically meaningful but consistent.
 * Used when Groq is unavailable — prevents data loss.
 *
 * @param {string} text
 * @returns {number[]} 128-dim vector
 */
function hashEmbedding(text) {
  const dims = 128;
  const vector = new Array(dims).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    vector[i % dims] += Math.sin(char * (i + 1)) * 0.5;
    vector[(i * 7) % dims] += Math.cos(char * (i + 3)) * 0.3;
  }

  return normalizeVector(vector);
}

// ============================================================
// COSINE SIMILARITY
// ============================================================

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} similarity score 0-1
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Normalize a vector to unit length.
 * @param {number[]} v
 * @returns {number[]}
 */
function normalizeVector(v) {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

// ============================================================
// STORE MESSAGE EMBEDDING
// ============================================================

/**
 * Store a message embedding with full metadata.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.messageId
 * @param {string} params.text — original message text
 * @param {object} params.metadata — { pile, tone, intent, emotion, from, sarcasm }
 * @param {object|null} params.userKeys
 */
async function storeMessageEmbedding({
  userId,
  messageId,
  text,
  metadata = {},
  userKeys = null,
}) {
  const vector = await generateEmbedding(text, userKeys);

  const doc = {
    message_id: messageId,
    vector,
    text_preview: text.substring(0, 200),
    metadata: {
      pile: metadata.pile || "casual",
      tone: metadata.tone || "neutral",
      emotion: metadata.emotion || "neutral",
      intent: metadata.intent || "unknown",
      sarcasm: metadata.sarcasm || false,
      from: metadata.from || null,
      replied: metadata.replied || false,
      reply_speed_mins: metadata.reply_speed_mins || null,
    },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    embedding_model: "groq/nomic-embed-text-v1_5",
  };

  await getDb()
    .collection("users")
    .doc(userId)
    .collection("embeddings")
    .doc(messageId)
    .set(doc);
}

// ============================================================
// SEMANTIC SEARCH
// ============================================================

/**
 * Find semantically similar messages for a user.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.queryText
 * @param {number} params.topK — number of results (default 5)
 * @param {object} params.filter — { pile, tone, from } pre-filter
 * @param {object|null} params.userKeys
 * @returns {Array} top-K similar messages with scores
 */
async function semanticSearch({
  userId,
  queryText,
  topK = 5,
  filter = {},
  userKeys = null,
}) {
  const queryVector = await generateEmbedding(queryText, userKeys);

  // Build Firestore query with pre-filters to reduce comparison set
  let query = getDb()
    .collection("users")
    .doc(userId)
    .collection("embeddings")
    .orderBy("created_at", "desc")
    .limit(200); // Max comparison window

  // Apply metadata pre-filters
  if (filter.pile) query = query.where("metadata.pile", "==", filter.pile);
  if (filter.from) query = query.where("metadata.from", "==", filter.from);

  const snapshot = await query.get();
  const results = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.vector) continue;

    const score = cosineSimilarity(queryVector, data.vector);
    results.push({
      id: doc.id,
      score,
      text_preview: data.text_preview,
      metadata: data.metadata,
      created_at: data.created_at,
    });
  }

  // Sort by similarity score descending
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ============================================================
// CONTACT MEMORY
// ============================================================

/**
 * Update the relationship vector for a contact.
 * Aggregates tone, intent, emotion patterns per sender.
 *
 * @param {string} userId
 * @param {string} contactPhone
 * @param {object} messageData — { tone, emotion, intent, sarcasm, pile }
 */
async function updateContactMemory(userId, contactPhone, messageData) {
  const ref = getDb()
    .collection("users")
    .doc(userId)
    .collection("contact_memory")
    .doc(contactPhone.replace(/\D/g, ""));

  const existing = await ref.get();
  const now = Date.now();

  if (!existing.exists) {
    // First message from this contact
    await ref.set({
      phone: contactPhone,
      message_count: 1,
      tone_history: [messageData.tone || "neutral"],
      emotion_history: [messageData.emotion || "neutral"],
      intent_history: [messageData.intent || "unknown"],
      sarcasm_rate: messageData.sarcasm ? 1 : 0,
      pile_distribution: { [messageData.pile || "casual"]: 1 },
      avg_reply_speed_mins: null,
      relationship_summary: null,
      last_updated: now,
      created_at: now,
    });
    return;
  }

  // Update existing contact memory
  const data = existing.data();
  const count = (data.message_count || 0) + 1;

  // Rolling history — keep last 50 entries
  const toneHistory = [...(data.tone_history || []), messageData.tone || "neutral"].slice(-50);
  const emotionHistory = [...(data.emotion_history || []), messageData.emotion || "neutral"].slice(-50);
  const intentHistory = [...(data.intent_history || []), messageData.intent || "unknown"].slice(-50);

  // Sarcasm rate (rolling average)
  const sarcasmRate = ((data.sarcasm_rate || 0) * (count - 1) + (messageData.sarcasm ? 1 : 0)) / count;

  // Pile distribution
  const pileDist = { ...(data.pile_distribution || {}) };
  const pile = messageData.pile || "casual";
  pileDist[pile] = (pileDist[pile] || 0) + 1;

  await ref.update({
    message_count: count,
    tone_history: toneHistory,
    emotion_history: emotionHistory,
    intent_history: intentHistory,
    sarcasm_rate: sarcasmRate,
    pile_distribution: pileDist,
    last_updated: now,
  });
}

/**
 * Get contact memory summary for triage pre-context.
 * @param {string} userId
 * @param {string} contactPhone
 * @returns {object|null}
 */
async function getContactMemory(userId, contactPhone) {
  const ref = getDb()
    .collection("users")
    .doc(userId)
    .collection("contact_memory")
    .doc(contactPhone.replace(/\D/g, ""));

  const doc = await ref.get();
  if (!doc.exists) return null;

  const data = doc.data();

  // Compute dominant tone + emotion
  const dominantTone = mostFrequent(data.tone_history || []);
  const dominantEmotion = mostFrequent(data.emotion_history || []);
  const dominantPile = Object.entries(data.pile_distribution || {})
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "casual";

  return {
    phone: contactPhone,
    message_count: data.message_count,
    dominant_tone: dominantTone,
    dominant_emotion: dominantEmotion,
    dominant_pile: dominantPile,
    sarcasm_rate: data.sarcasm_rate,
    relationship_summary: data.relationship_summary,
  };
}

// ============================================================
// PATTERN STORAGE
// ============================================================

/**
 * Save a daily pattern snapshot.
 * Called by memoryEngine.js after pattern analysis.
 *
 * @param {string} userId
 * @param {object} patternData
 */
async function storePattern(userId, patternData) {
  const dateKey = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  await getDb()
    .collection("users")
    .doc(userId)
    .collection("patterns")
    .doc(dateKey)
    .set({
      ...patternData,
      date: dateKey,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

// ============================================================
// UTILITIES
// ============================================================

function mostFrequent(arr) {
  if (!arr || arr.length === 0) return null;
  const freq = {};
  for (const item of arr) freq[item] = (freq[item] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = {
  generateEmbedding,
  hashEmbedding,
  cosineSimilarity,
  storeMessageEmbedding,
  semanticSearch,
  updateContactMemory,
  getContactMemory,
  storePattern,
};
