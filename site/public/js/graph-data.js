/**
 * graph-data.js — turns the vault into the "map": people, topics, open
 * commitments and supports, linked where they connect. Pure and local: no AI is
 * needed to build it (an AI can optionally tidy the topic names afterwards).
 */

import { tokenizeWithForms, messagesFor, openLoops } from "./search.js";
import { clip } from "./utils.js";

export const NODE_TYPES = ["person", "topic", "commitment", "support"];

// Words that are common in chat but make poor "topics".
const CHAT_STOP = new Set(
  "hey hello thanks thank please okay sure yes yeah good great lol haha need want like just know think going would could really much well also today tonight tomorrow got get let see come back sorry maybe thing things time make made still even then than there here now one two before after again yourself myself anyone someone something everyone anything around another other each every while though because since until over into upon actually definitely probably merry".split(" ")
);

export const normalizeSupport = (t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const REPLY_BY = { none: "No reply needed", today: "Reply today", this_week: "Reply this week", whenever: "Reply whenever" };

function topicLabelFor(stemWord, forms, labels) {
  const custom = labels?.[stemWord];
  if (custom) return custom;
  let best = stemWord, n = 0;
  for (const [w, c] of forms) if (c > n || (c === n && w.length < best.length)) { best = w; n = c; }
  return best.charAt(0).toUpperCase() + best.slice(1);
}

/**
 * @param {object} vault
 * @param {{people?:boolean,topics?:boolean,commitments?:boolean,supports?:boolean,maxPeople?:number,maxTopics?:number,maxCommitments?:number}} opts
 */
export function buildGraph(vault, opts = {}) {
  const o = { people: true, topics: true, commitments: true, supports: true, maxPeople: 60, maxTopics: 14, maxCommitments: 15, ...opts };
  const nodes = [];
  const links = [];
  const byId = new Map();
  const add = (n) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n); } return byId.get(n.id); };
  const link = (a, b, weight = 1, kind = "") => { if (byId.has(a) && byId.has(b)) links.push({ source: a, target: b, weight, kind }); };

  // ── people (always the backbone; hidden people just hide their own node) ──
  const counts = new Map(vault.people.map((p) => [p.id, 0]));
  for (const m of vault.messages) counts.set(m.personId, (counts.get(m.personId) ?? 0) + 1);
  const ranked = [...vault.people]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, o.maxPeople);
  const inGraph = new Set(ranked.map((p) => p.id));
  const personNodeId = (id) => `p:${id}`;

  // The people nodes are always created so other nodes have something to attach to;
  // the `people` filter only controls whether they're drawn (see `hidden`).
  for (const p of ranked) {
    add({
      id: personNodeId(p.id), type: "person", label: p.name, weight: Math.max(1, counts.get(p.id) ?? 0),
      category: p.category === "work" ? "work" : "personal", personId: p.id, hidden: !o.people,
      meta: { relationship: p.relationship || "", messages: counts.get(p.id) ?? 0, supports: (p.supports ?? []).length },
    });
  }

  // ── topics: words that recur, weighted toward ones shared by several people ──
  if (o.topics && vault.messages.length) {
    const nameTokens = new Set(vault.people.flatMap((p) => tokenizeWithForms(p.name).map((t) => t.stem)));
    const recent = vault.messages.length > 5000 ? vault.messages.slice(-5000) : vault.messages;
    const stats = new Map(); // stem → { df, people:Map(personId→count), forms:Map(word→count) }
    const docs = [];
    for (const m of recent) {
      const toks = tokenizeWithForms(m.text);
      const seen = new Set();
      const stems = [];
      for (const { stem, word } of toks) {
        if (word.length < 4 || CHAT_STOP.has(word) || CHAT_STOP.has(stem) || nameTokens.has(stem) || /^\d+$/.test(word)) continue;
        let s = stats.get(stem);
        if (!s) stats.set(stem, (s = { df: 0, people: new Map(), forms: new Map() }));
        s.forms.set(word, (s.forms.get(word) ?? 0) + 1);
        if (!seen.has(stem)) {
          seen.add(stem);
          stems.push(stem);
          s.df += 1;
          s.people.set(m.personId, (s.people.get(m.personId) ?? 0) + 1);
        }
      }
      docs.push(stems);
    }
    const N = recent.length;
    const pick = (minDf) => [...stats.entries()]
      .filter(([, s]) => s.df >= minDf && [...s.people.keys()].some((id) => inGraph.has(id)))
      .map(([stem, s]) => ({ stem, s, score: s.df * Math.log(1 + N / s.df) * (1 + 0.5 * (s.people.size - 1)) }))
      .sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem))
      .slice(0, o.maxTopics);
    let chosen = pick(N >= 30 ? 3 : 2);
    if (chosen.length < 3) chosen = pick(1);
    const chosenStems = new Set(chosen.map((c) => c.stem));
    for (const { stem, s } of chosen) {
      // co-occurring words, used to give the optional AI naming step some context
      const co = new Map();
      for (const d of docs) if (d.includes(stem)) for (const x of d) if (x !== stem) co.set(x, (co.get(x) ?? 0) + 1);
      const related = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => topicLabelFor(x, stats.get(x)?.forms ?? new Map(), null).toLowerCase());
      add({ id: `t:${stem}`, type: "topic", label: topicLabelFor(stem, s.forms, vault.graph?.labels), weight: s.df, stem, meta: { messages: s.df, related, word: topicLabelFor(stem, s.forms, null).toLowerCase() } });
    }
    for (const stem of chosenStems) {
      for (const [pid, n] of stats.get(stem).people) if (inGraph.has(pid)) link(personNodeId(pid), `t:${stem}`, n, "topic");
    }
  }

  // ── commitments: things still waiting on the user ──
  if (o.commitments) {
    const nameOf = new Map(vault.people.map((p) => [p.id, p.name]));
    const loops = openLoops(vault).filter((m) => inGraph.has(m.personId)).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, o.maxCommitments);
    for (const m of loops) {
      const ask = m.analysis?.asks?.[0];
      add({
        id: `c:${m.id}`, type: "commitment", label: clip(ask || `Reply to ${nameOf.get(m.personId) ?? "them"}`, 44), weight: 2, messageId: m.id, personId: m.personId,
        meta: { due: REPLY_BY[m.analysis?.reply_by] ?? "Waiting for your reply", dates: m.analysis?.dates ?? [], snippet: clip(m.text.replace(/\s+/g, " "), 140) },
      });
      link(personNodeId(m.personId), `c:${m.id}`, 2, "commitment");
    }
  }

  // ── supports: what helps with each person (shared ones bridge people) ──
  if (o.supports) {
    for (const p of ranked) {
      for (const s of p.supports ?? []) {
        const key = normalizeSupport(s.text);
        if (!key) continue;
        const node = add({ id: `s:${key}`, type: "support", label: clip(s.text, 40), weight: 1, meta: { people: [] } });
        node.meta.people.push(p.name);
        link(personNodeId(p.id), node.id, 1, "support");
      }
    }
  }

  // Drop hidden people from the drawn set but keep their links out too.
  const visible = nodes.filter((n) => !n.hidden);
  const ids = new Set(visible.map((n) => n.id));
  const visibleLinks = links.filter((l) => ids.has(l.source) && ids.has(l.target));
  // Orphans (e.g. topics whose only people are hidden) add nothing — drop them.
  const linked = new Set(visibleLinks.flatMap((l) => [l.source, l.target]));
  const finalNodes = visible.filter((n) => n.type === "person" || linked.has(n.id));
  return { nodes: finalNodes, links: visibleLinks, messageCount: vault.messages.length };
}

export function neighbours(graph, id) {
  const out = new Set();
  for (const l of graph.links) {
    if (l.source === id) out.add(l.target);
    else if (l.target === id) out.add(l.source);
  }
  return [...out].map((x) => graph.nodes.find((n) => n.id === x)).filter(Boolean);
}

export { messagesFor };
