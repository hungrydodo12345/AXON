/**
 * search.js — dependency-free keyword search (BM25) over the vault.
 *
 * No embeddings, no vectors, no service: the vault is small enough to index in
 * memory on demand, and this keeps the vault file tiny and fully private.
 */

const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i if in is it its me my of on or our she so that the their them they this to us was we were what when where which who will with you your about did do does not no yes".split(" ")
);

export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]+/gu)
    ?.map(stem)
    .filter((t) => t.length > 1 && !STOP.has(t)) ?? [];
}

function stem(t) {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

let cache = { key: "", docs: [], df: new Map(), avg: 1 };

function buildIndex(vault) {
  const last = vault.messages[vault.messages.length - 1];
  const key = `${vault.id}:${vault.messages.length}:${last?.id ?? ""}:${vault.people.map((p) => p.name).join("\u0001")}`;
  if (cache.key === key) return cache;
  const nameOf = new Map(vault.people.map((p) => [p.id, p.name]));
  const docs = vault.messages.map((m) => {
    const tokens = tokenize(`${nameOf.get(m.personId) ?? ""} ${m.text}`);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: m.id, personId: m.personId, len: tokens.length || 1, tf };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  cache = { key, docs, df, avg };
  return cache;
}

/** Returns messages ranked by relevance, newest first on ties. */
export function searchMessages(vault, query, { personId = null, limit = 8 } = {}) {
  const q = tokenize(query);
  const msgById = new Map(vault.messages.map((m) => [m.id, m]));
  const { docs, df, avg } = buildIndex(vault);
  const N = docs.length || 1;
  const k1 = 1.4, b = 0.7;
  const scored = [];
  for (const d of docs) {
    if (personId && d.personId !== personId) continue;
    let score = 0;
    for (const term of q) {
      const f = d.tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg));
    }
    if (score > 0) scored.push({ message: msgById.get(d.id), score });
  }
  scored.sort(
    (a, b2) => b2.score - a.score || new Date(b2.message.ts) - new Date(a.message.ts)
  );
  return scored.slice(0, limit).map((s) => ({ ...s.message, score: Number(s.score.toFixed(3)) }));
}

/** Find a person by (possibly partial) name. Exact > prefix > substring. */
export function findPerson(vault, name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const people = vault.people;
  return (
    people.find((p) => p.name.toLowerCase() === n) ||
    people.find((p) => p.name.toLowerCase().startsWith(n)) ||
    people.find((p) => p.name.toLowerCase().split(/\s+/).some((w) => w === n)) ||
    people.find((p) => p.name.toLowerCase().includes(n)) ||
    null
  );
}

export function messagesFor(vault, personId) {
  return vault.messages
    .filter((m) => m.personId === personId)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

/** Incoming messages the user still owes a reply to. */
export function openLoops(vault) {
  return vault.messages
    .filter((m) => m.direction === "in" && m.needsReply === true && m.status !== "replied" && m.status !== "dismissed")
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}
