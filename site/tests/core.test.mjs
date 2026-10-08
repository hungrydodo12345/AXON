import { test } from "node:test";
import assert from "node:assert/strict";

import { createEmptyVault, newSession, seal, openVault, peekVault, vaultFileName, normalizeVault, passphraseStrength, VaultError } from "../public/js/vault.js";
import { parseWhatsAppExport } from "../public/js/whatsapp.js";
import { searchMessages, findPerson, openLoops, tokenize } from "../public/js/search.js";
import { extractJson, normalizeAnalysis, analyzeMessage } from "../public/js/analyze.js";
import { callModel, isConfigured, ProviderError } from "../public/js/providers.js";
import { askVault } from "../public/js/agent.js";

// ── helpers ──
function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    return handler(String(url), init, calls.length - 1);
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
const openaiReply = (text) => ok({ choices: [{ message: { content: text } }] });

function sampleVault() {
  const v = createEmptyVault("Ada");
  v.people.push({ id: "p1", name: "Morgan Lee", category: "work", relationship: "coworker", notes: "", createdAt: "2026-01-01" });
  v.people.push({ id: "p2", name: "Sam", category: "personal", relationship: "sister", notes: "", createdAt: "2026-01-01" });
  const mk = (id, personId, text, ts, extra = {}) => ({ id, personId, text, ts, direction: "in", status: "new", ...extra });
  v.messages.push(
    mk("m1", "p1", "Can you review the repository changes before Friday?", "2026-03-02T10:00:00Z", { needsReply: true }),
    mk("m2", "p1", "Thanks for the quick turnaround on the deploy.", "2026-03-04T10:00:00Z", { needsReply: false }),
    mk("m3", "p2", "Dinner on Sunday? Mum is making lasagna", "2026-03-05T18:00:00Z", { needsReply: true }),
    mk("m4", "p2", "never mind, sorted it", "2026-03-06T18:00:00Z", { direction: "out" })
  );
  return v;
}

// ── vault ──
test("vault: encrypt → decrypt round trip keeps everything", async () => {
  const v = sampleVault();
  v.revision = 7;
  const session = await newSession("correct horse battery staple");
  const text = await seal(v, session);
  const file = JSON.parse(text);
  assert.equal(file.format, "axon-vault");
  assert.ok(!text.includes("Morgan") && !text.includes("lasagna"), "plaintext must not leak into the file");
  assert.ok(!("revision" in file), "revision lives inside the ciphertext");
  const { vault, session: s2 } = await openVault(text, "correct horse battery staple");
  assert.equal(vault.revision, 7);
  assert.deepEqual(vault.people, normalizeVault(v).people, "people survive the round trip (supports default to [])");
  assert.deepEqual(vault.messages, v.messages);
  // re-sealing with the reopened session works
  const again = await seal(vault, s2);
  assert.notEqual(JSON.parse(again).iv, file.iv, "fresh IV on every save");
  await openVault(again, "correct horse battery staple");
});

test("vault: wrong passphrase is rejected clearly", async () => {
  const session = await newSession("right-passphrase-1");
  const text = await seal(sampleVault(), session);
  await assert.rejects(() => openVault(text, "wrong-passphrase-1"), (e) => e instanceof VaultError && e.code === "bad_passphrase");
});

test("vault: tampering with ciphertext or header fails authentication", async () => {
  const session = await newSession("tamper-test-phrase");
  const file = JSON.parse(await seal(sampleVault(), session));
  const flipped = { ...file, data: file.data.slice(0, 20) + (file.data[20] === "A" ? "B" : "A") + file.data.slice(21) };
  await assert.rejects(() => openVault(JSON.stringify(flipped), "tamper-test-phrase"), (e) => e.code === "bad_passphrase");
  const hdr = { ...file, compression: file.compression === "gzip" ? "none" : "gzip" };
  await assert.rejects(() => openVault(JSON.stringify(hdr), "tamper-test-phrase"), (e) => e.code === "bad_passphrase");
});

test("vault: non-vault and too-new files give friendly errors", () => {
  assert.throws(() => peekVault("hello"), (e) => e.code === "not_vault");
  assert.throws(() => peekVault('{"format":"other"}'), (e) => e.code === "not_vault");
  assert.throws(() => peekVault(JSON.stringify({ format: "axon-vault", version: 99, data: "x", kdf: { iterations: 600000, salt: "AAAA" } })), (e) => e.code === "too_new");
  assert.throws(() => peekVault(JSON.stringify({ format: "axon-vault", version: 1, data: "x", kdf: { iterations: 1, salt: "AAAA" } })), (e) => e.code === "corrupt");
});

test("vault: file name carries revision + timestamp", () => {
  const v = createEmptyVault();
  v.revision = 12;
  assert.equal(vaultFileName(v, new Date(2026, 9, 7, 14, 5)), "axon-vault_r12_2026-10-07_1405.axon");
});

test("vault: normalize fills gaps and drops junk", () => {
  const v = normalizeVault({ people: [{ id: "a", name: "A" }, null, { id: "b" }], messages: [{ id: "x", text: "hi" }, { id: "y" }] });
  assert.equal(v.people.length, 1);
  assert.equal(v.messages.length, 1);
  assert.ok(v.settings.needs && v.provider && v.tour);
  assert.throws(() => normalizeVault(null), VaultError);
});

test("vault: passphrase strength rewards length", () => {
  assert.equal(passphraseStrength("short").level, 0);
  assert.equal(passphraseStrength("four random words here ok").level, 3);
});

// ── whatsapp ──
test("whatsapp: iOS + Android formats, multi-line, system lines, day-first detection", () => {
  const ios = [
    "[25/12/2025, 9:15:02 AM] Sam: Merry Christmas!",
    "[25/12/2025, 9:16:10 AM] Ada: You too",
    "that was fun",
    "[25/12/2025, 9:17:00 AM] Sam: <Media omitted>",
    "[25/12/2025, 9:18:00 AM] Sam: Messages and calls are end-to-end encrypted.",
  ].join("\n");
  const a = parseWhatsAppExport(ios);
  assert.equal(a.length, 2);
  assert.equal(a[1].text, "You too\nthat was fun");
  assert.equal(a[0].timestamp.getMonth(), 11);
  assert.equal(a[0].timestamp.getDate(), 25);
  assert.equal(a[0].timestamp.getHours(), 9);

  const android = "12/31/25, 11:59 PM - Morgan: See you next year\n1/2/26, 08:00 - Morgan: Back at it";
  const b = parseWhatsAppExport(android);
  assert.equal(b.length, 2);
  assert.equal(b[0].timestamp.getMonth(), 11, "31 forces month-first");
  assert.equal(b[0].timestamp.getHours(), 23);
  assert.deepEqual(parseWhatsAppExport("garbage"), []);
});

// ── search ──
test("search: BM25 ranks relevant messages and respects person filter", () => {
  const v = sampleVault();
  const hits = searchMessages(v, "repository review");
  assert.equal(hits[0].id, "m1");
  assert.equal(searchMessages(v, "lasagna", { personId: "p1" }).length, 0);
  assert.equal(searchMessages(v, "lasagna", { personId: "p2" })[0].id, "m3");
  assert.equal(findPerson(v, "morgan").id, "p1");
  assert.equal(findPerson(v, "nobody"), null);
  assert.deepEqual(openLoops(v).map((m) => m.id), ["m1", "m3"]);
  assert.ok(tokenize("The Café is OPEN!").includes("cafe"));
});

// ── analysis parsing ──
test("analyze: extractJson survives fences, chatter and nested braces", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go: {"a":{"b":"}"}} hope that helps'), { a: { b: "}" } });
  assert.equal(extractJson("no json here"), null);
});

test("analyze: normalizeAnalysis clamps unknown values", () => {
  const n = normalizeAnalysis({
    summary: "Hi", plain_meaning: "Hello", tone: { label: "WEIRD", confidence: "HIGH", evidence: "x" },
    pile: "nope", needs_reply: "true", reply_by: "someday", asks: ["a", 5], replies: [{ style: "warm", text: "Hey" }, { text: "" }],
  });
  assert.equal(n.tone.label, "unclear");
  assert.equal(n.tone.confidence, "high");
  assert.equal(n.pile, "casual");
  assert.equal(n.needs_reply, true);
  assert.equal(n.reply_by, "whenever");
  assert.deepEqual(n.asks, ["a"]);
  assert.equal(n.replies.length, 1);
  assert.equal(normalizeAnalysis({}), null);
});

test("analyze: analyzeMessage repairs a bad first answer once", async () => {
  const v = sampleVault();
  v.provider = { mode: "custom", preset: "groq", kind: "openai", baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k" };
  const good = JSON.stringify({ summary: "Asks for a review", plain_meaning: "Please review by Friday", tone: { label: "neutral", confidence: "medium", evidence: "plain request" }, pile: "important", needs_reply: true, reply_by: "this_week", asks: ["review"], dates: ["Friday"], reassurance: "", replies: [{ style: "warm", text: "Sure!" }, { style: "brief", text: "Yes" }, { style: "boundary", text: "Not today" }] });
  const f = mockFetch((_u, _i, n) => openaiReply(n === 0 ? "I think it is fine" : good));
  try {
    const out = await analyzeMessage(v, v.messages[0], v.people[0]);
    assert.equal(f.calls.length, 2);
    assert.equal(out.pile, "important");
    assert.equal(out.replies.length, 3);
    // the untrusted message text is delimited, and context is included
    assert.match(f.calls[0].body.messages.at(-1).content, /<<<MESSAGE[\s\S]*repository[\s\S]*MESSAGE>>>/);
    assert.match(f.calls[0].body.messages.at(-1).content, /Morgan Lee/);
  } finally { f.restore(); }
});

// ── providers ──
test("providers: openai-compatible, anthropic and gemini use the right wire format", async () => {
  const f = mockFetch((url) => {
    if (url.includes("anthropic")) return ok({ content: [{ type: "text", text: "from-claude" }] });
    if (url.includes("generativelanguage")) return ok({ candidates: [{ content: { parts: [{ text: "from-gemini" }] } }] });
    return openaiReply("from-openai");
  });
  try {
    const base = { mode: "custom", model: "m", apiKey: "KEY" };
    const req = { system: "SYS", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "again" }] };

    assert.equal(await callModel({ ...base, preset: "openai", kind: "openai", baseUrl: "https://api.openai.com/v1/" }, req), "from-openai");
    assert.equal(f.calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(f.calls[0].init.headers.Authorization, "Bearer KEY");
    assert.equal(f.calls[0].body.messages[0].role, "system");

    assert.equal(await callModel({ ...base, preset: "anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" }, req), "from-claude");
    assert.equal(f.calls[1].url, "https://api.anthropic.com/v1/messages");
    assert.equal(f.calls[1].init.headers["x-api-key"], "KEY");
    assert.equal(f.calls[1].init.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(f.calls[1].body.system, "SYS");

    assert.equal(await callModel({ ...base, preset: "gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-x" }, req), "from-gemini");
    assert.equal(f.calls[2].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    assert.equal(f.calls[2].init.headers["x-goog-api-key"], "KEY");
    assert.equal(f.calls[2].body.contents[1].role, "model");
    assert.ok(!f.calls[2].url.includes("KEY"), "key must never be in the URL");
  } finally { f.restore(); }
});

test("providers: local models need no key; errors are friendly", async () => {
  assert.equal(isConfigured({ mode: "custom", preset: "ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2", apiKey: "" }), true);
  assert.equal(isConfigured({ mode: "custom", preset: "openai", baseUrl: "https://x", model: "m", apiKey: "" }), false);
  assert.equal(isConfigured({ mode: "none" }), false);
  await assert.rejects(() => callModel({ mode: "none" }, { messages: [] }), (e) => e.code === "not_configured");

  const p = { mode: "custom", preset: "openai", kind: "openai", baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k" };
  for (const [status, code] of [[401, "auth"], [429, "rate_limit"], [404, "bad_response"], [500, "bad_response"]]) {
    const f = mockFetch(() => new Response(JSON.stringify({ error: { message: "nope" } }), { status }));
    try { await assert.rejects(() => callModel(p, { messages: [{ role: "user", content: "x" }] }), (e) => e instanceof ProviderError && e.code === code); }
    finally { f.restore(); }
  }
  const f = mockFetch(() => { throw new TypeError("Failed to fetch"); });
  try { await assert.rejects(() => callModel(p, { messages: [{ role: "user", content: "x" }] }), (e) => e.code === "network" && /api\.example\.test/.test(e.message)); }
  finally { f.restore(); }
});

test("providers: trial → /api/trial; 404 means trial is off", async () => {
  const f = mockFetch(() => new Response("{}", { status: 404 }));
  try { await assert.rejects(() => callModel({ mode: "trial" }, { messages: [{ role: "user", content: "x" }] }), (e) => e.code === "trial_off"); }
  finally { f.restore(); }
  const g = mockFetch(() => ok({ text: "hello" }));
  try {
    assert.equal(await callModel({ mode: "trial" }, { system: "s", messages: [{ role: "user", content: "x" }] }), "hello");
    assert.equal(g.calls[0].url, "/api/trial");
  } finally { g.restore(); }
});

// ── agent ──
test("agent: runs tools over the vault, then answers with valid sources only", async () => {
  const v = sampleVault();
  v.provider = { mode: "custom", preset: "groq", kind: "openai", baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k" };
  const script = [
    JSON.stringify({ action: "tool", tool: "search_messages", args: { query: "repository", person: "Morgan" } }),
    JSON.stringify({ action: "tool", tool: "open_loops", args: {} }),
    JSON.stringify({ action: "answer", answer: "Morgan asked on 2 Mar for a repository review before Friday.", sources: ["m1", "bogus-id"] }),
  ];
  const f = mockFetch((_u, _i, n) => openaiReply(script[n]));
  try {
    const seen = [];
    const out = await askVault(v, "What did Morgan say about the repository?", { onStep: (s) => seen.push(s.tool) });
    assert.deepEqual(seen, ["search_messages", "open_loops"]);
    assert.deepEqual(out.sources, ["m1"], "invented ids are dropped");
    assert.match(out.answer, /Morgan/);
    const toolMsg = f.calls[1].body.messages.at(-1).content;
    assert.match(toolMsg, /TOOL_RESULT/);
    assert.match(toolMsg, /m1/);
  } finally { f.restore(); }
});

test("agent: survives garbage and unknown tools without crashing", async () => {
  const v = sampleVault();
  v.provider = { mode: "custom", preset: "groq", kind: "openai", baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k" };
  const script = ["blah", JSON.stringify({ action: "tool", tool: "rm_rf", args: {} }), JSON.stringify({ action: "answer", answer: "I don't see that.", sources: [] })];
  const f = mockFetch((_u, _i, n) => openaiReply(script[n]));
  try {
    const out = await askVault(v, "anything");
    assert.equal(out.answer, "I don't see that.");
    assert.match(f.calls[2].body.messages.at(-1).content, /Unknown tool/);
  } finally { f.restore(); }
});

// ═════════ map / graph ═════════
import { buildGraph, neighbours, normalizeSupport } from "../public/js/graph-data.js";
import { createLayout, project, makeView, fitView, nodeRadius, hash32 } from "../public/js/graph-layout.js";

function mapVault() {
  const v = sampleVault();
  const add = (id, personId, text, extra = {}) => v.messages.push({ id, personId, text, ts: "2026-03-07T10:00:00Z", direction: "in", status: "new", needsReply: false, ...extra });
  add("m5", "p1", "The repository deploy failed again, review the repository logs please.");
  add("m6", "p2", "Dinner at mum's again? The lasagna was great last time.");
  v.people[0].supports = [{ id: "s1", text: "Needs time to reply" }, { id: "s2", text: "Prefers text over calls" }];
  v.people[1].supports = [{ id: "s3", text: "needs  time to reply " }];
  v.messages[0].analysis = { asks: ["Review the repository changes"], reply_by: "today", dates: ["Friday"] };
  return v;
}

test("graph: people, topics, commitments and supports are built and linked", () => {
  const g = buildGraph(mapVault());
  const types = (t) => g.nodes.filter((n) => n.type === t);
  assert.equal(types("person").length, 2);
  assert.ok(types("topic").some((t) => t.label === "Repository"), "recurring word becomes a topic");
  assert.ok(types("topic").some((t) => t.label === "Lasagna" || t.label === "Dinner"));
  assert.ok(!types("topic").some((t) => /morgan|sam/i.test(t.label)), "person names are not topics");
  const c = types("commitment");
  assert.equal(c.length, 2, "m1 and m3 are open loops");
  assert.ok(c.some((n) => n.label === "Review the repository changes" && n.meta.due === "Reply today"));
  // shared support text (different case/spacing) merges into ONE node linking both people
  const shared = types("support").filter((n) => n.id === `s:${normalizeSupport("Needs time to reply")}`);
  assert.equal(shared.length, 1);
  assert.equal(neighbours(g, shared[0].id).length, 2);
  for (const l of g.links) assert.ok(g.nodes.some((n) => n.id === l.source) && g.nodes.some((n) => n.id === l.target), "no dangling links");
});

test("graph: filters hide node types without leaving orphans", () => {
  const v = mapVault();
  const g = buildGraph(v, { topics: false, commitments: false, supports: false });
  assert.deepEqual([...new Set(g.nodes.map((n) => n.type))], ["person"]);
  const noPeople = buildGraph(v, { people: false });
  assert.equal(noPeople.nodes.length, 0, "everything hangs off people, so hiding them leaves nothing orphaned");
});

test("graph: topics prefer words shared by several people; custom labels win; caps hold", () => {
  const v = createEmptyVault();
  for (let i = 0; i < 80; i++) v.people.push({ id: `p${i}`, name: `Person${i}`, category: i % 2 ? "work" : "personal", relationship: "", notes: "", supports: [] });
  for (let i = 0; i < 400; i++) v.messages.push({ id: `m${i}`, personId: `p${i % 80}`, text: `budget meeting ${["alpha", "bravo", "charlie", "delta"][i % 4]} planning project${i % 30}`, ts: "2026-01-01T00:00:00Z", direction: "in", status: "new", needsReply: null });
  v.graph.labels = { budget: "Money talk" };
  const g = buildGraph(v);
  assert.ok(g.nodes.filter((n) => n.type === "person").length <= 60);
  assert.ok(g.nodes.filter((n) => n.type === "topic").length <= 14);
  assert.ok(g.nodes.some((n) => n.label === "Money talk"));
});

test("layout: deterministic, finite and bounded; warm start keeps positions", () => {
  const g = buildGraph(mapVault());
  const a = createLayout(g); a.settle(300);
  const b = createLayout(g); b.settle(300);
  assert.deepEqual(a.snapshot(), b.snapshot(), "same vault → same layout");
  for (const p of a.positions) { assert.ok([p.x, p.y, p.z].every(Number.isFinite)); assert.ok(Math.hypot(p.x, p.y, p.z) < 700); }
  const warm = createLayout(g, a.snapshot());
  assert.deepEqual(warm.snapshot(), a.snapshot());
  assert.notEqual(hash32("a"), hash32("b"));
});

test("camera: projection is stable, perspective shrinks far nodes, flat mode ignores depth", () => {
  const v = makeView();
  const near = project({ x: 0, y: 0, z: -200 }, { ...v, yaw: 0, pitch: 0 }, 800, 600);
  const far = project({ x: 100, y: 0, z: 300 }, { ...v, yaw: 0, pitch: 0 }, 800, 600);
  assert.ok(near.scale > far.scale && near.depth < far.depth);
  const flat = project({ x: 50, y: -20, z: 999 }, { ...v, mode: "flat", zoom: 2 }, 800, 600);
  assert.deepEqual([flat.x, flat.y], [500, 260]);
  // fitting fills the canvas and centres an off-centre graph
  const pts = [{ x: 100, y: 100, z: 0 }, { x: 400, y: 160, z: 0 }, { x: 250, y: 130, z: 40 }];
  const fit = fitView(pts, { ...v, mode: "flat" }, 800, 600);
  assert.ok(fit.zoom > 0.35 && fit.zoom <= 3.2);
  const a = project(pts[0], { ...v, mode: "flat", ...fit }, 800, 600), b = project(pts[1], { ...v, mode: "flat", ...fit }, 800, 600);
  assert.ok(Math.abs((a.x + b.x) / 2 - 400) < 1 && Math.abs((a.y + b.y) / 2 - 300) < 40, "graph is centred");
  assert.ok(Math.max(a.x, b.x) - Math.min(a.x, b.x) > 400, "small graphs are scaled up to fill the space");
  assert.deepEqual(fitView([], v, 800, 600), { zoom: 1, panX: 0, panY: 0 });
  assert.ok(nodeRadius({ type: "person", weight: 50 }) > nodeRadius({ type: "person", weight: 1 }));
});
