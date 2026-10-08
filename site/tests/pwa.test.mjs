import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEmptyVault } from "../public/js/vault.js";
import { deviceCopyIsNewer } from "../public/js/device.js";
import { buildUserPrompt, buildSystemPrompt, labelTopics } from "../public/js/analyze.js";
import { callModel } from "../public/js/providers.js";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test("service worker precaches every shipped file (so offline never misses one)", () => {
  const sw = fs.readFileSync(path.join(pub, "sw.js"), "utf8");
  const listed = new Set([...sw.matchAll(/^\s+"(\.\/[^"]*)",?$/gm)].map((m) => m[1]));
  const IGNORE = new Set(["_headers", "sw.js"]);
  const missing = [];
  for (const file of walk(pub)) {
    const rel = path.relative(pub, file).split(path.sep).join("/");
    if (IGNORE.has(rel)) continue;
    if (!listed.has(`./${rel}`)) missing.push(rel);
  }
  assert.deepEqual(missing, [], "add these to SHELL in public/sw.js and bump VERSION");
  for (const u of listed) {
    if (u === "./") continue;
    assert.ok(fs.existsSync(path.join(pub, u)), `sw.js lists a file that doesn't exist: ${u}`);
  }
  assert.match(sw, /const VERSION = "axon-shell-/);
});

test("manifest is installable: name, start_url, standalone, and real icons incl. maskable", () => {
  const m = JSON.parse(fs.readFileSync(path.join(pub, "manifest.webmanifest"), "utf8"));
  assert.ok(m.name && m.short_name && m.start_url === "./" && m.scope === "./");
  assert.equal(m.display, "standalone");
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(sizes.includes("192x192:any") && sizes.includes("512x512:any") && sizes.includes("512x512:maskable"));
  for (const i of m.icons) {
    const f = path.join(pub, i.src);
    assert.ok(fs.existsSync(f), `missing icon ${i.src}`);
    const png = fs.readFileSync(f);
    assert.equal(png.readUInt32BE(16), parseInt(i.sizes, 10), `${i.src} width matches its declared size`);
  }
  const html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
});

test("service worker never touches the API relay or cross-origin AI calls", () => {
  const sw = fs.readFileSync(path.join(pub, "sw.js"), "utf8");
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
  assert.match(sw, /includes\("\/api\/"\)\) return/);
  assert.match(sw, /req\.method !== "GET"\) return/);
});

test("device copy: only counts as newer when clearly later than the file", () => {
  const vault = { updatedAt: "2026-10-08T10:00:00.000Z" };
  assert.equal(deviceCopyIsNewer({ savedAt: "2026-10-08T10:00:00.500Z" }, vault), false, "within 1s = same save");
  assert.equal(deviceCopyIsNewer({ savedAt: "2026-10-08T10:05:00.000Z" }, vault), true);
  assert.equal(deviceCopyIsNewer({ savedAt: "2026-10-08T09:00:00.000Z" }, vault), false);
  assert.equal(deviceCopyIsNewer(null, vault), false);
});

test("new vaults carry the device-copy and graph fields, off by default", () => {
  const v = createEmptyVault();
  assert.equal(v.settings.deviceCopy, false);
  assert.equal(v.deviceSlot, "");
  assert.deepEqual(v.graph, { labels: {} });
});

test("supports are handed to the AI as context, with a rule to honour them", () => {
  const v = createEmptyVault("Alex");
  const person = { id: "p", name: "Sam", category: "personal", relationship: "sister", notes: "", supports: [{ id: "1", text: "Needs time to reply" }, { id: "2", text: "Prefers text to calls" }] };
  v.people.push(person);
  const msg = { id: "m", personId: "p", text: "Call me tonight?", ts: "2026-10-08T10:00:00Z", direction: "in" };
  v.messages.push(msg);
  const prompt = buildUserPrompt(v, msg, person);
  assert.match(prompt, /What helps the user with this person[^\n]*Needs time to reply; Prefers text to calls/);
  assert.match(buildSystemPrompt(v), /buys time|prefers text/i);
  const none = buildUserPrompt(v, msg, { ...person, supports: [] });
  assert.ok(!/What helps the user/.test(none));
});

test("offline: AI calls fail fast with a friendly message — but local models still try", async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  const orig = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] })); };
  try {
    const req = { messages: [{ role: "user", content: "x" }] };
    await assert.rejects(() => callModel({ mode: "custom", preset: "openai", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "m", apiKey: "k" }, req), (e) => e.code === "network" && /offline/i.test(e.message));
    await assert.rejects(() => callModel({ mode: "trial" }, req), (e) => /offline/i.test(e.message));
    assert.equal(called, 0, "no request is attempted while offline");
    const out = await callModel({ mode: "custom", preset: "ollama", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "m", apiKey: "" }, req);
    assert.equal(out, "hi");
  } finally {
    globalThis.fetch = orig;
    if (desc) Object.defineProperty(globalThis, "navigator", desc); else delete globalThis.navigator;
  }
});

test("topic naming sends keywords only (never message text) and ignores invented ids", async () => {
  const v = createEmptyVault();
  v.provider = { mode: "custom", preset: "groq", kind: "openai", baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k" };
  const topics = [
    { stem: "repositori", meta: { word: "repository", related: ["review", "friday"] } },
    { stem: "dinner", meta: { word: "dinner", related: ["saturday"] } },
  ];
  let sent;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ labels: { repositori: "Code review", dinner: "Dinner plans", invented: "Nope", dinner2: 5 } }) } }] })); };
  try {
    const labels = await labelTopics(v, topics);
    assert.deepEqual(labels, { repositori: "Code review", dinner: "Dinner plans" });
    const payload = sent.messages.map((m) => m.content).join("\n");
    assert.match(payload, /repository/);
    assert.ok(!/Hello there|lasagna/i.test(payload), "no message text in the request");
  } finally { globalThis.fetch = orig; }
});
