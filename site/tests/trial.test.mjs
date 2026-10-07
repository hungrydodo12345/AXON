import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import trial from "../functions/trial.mjs";

const URL_ = "https://axon.example.test/api/trial";
const post = (body, headers = {}) =>
  new Request(URL_, { method: "POST", headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": "1.1.1.1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const good = { system: "s", messages: [{ role: "user", content: "hello" }], maxTokens: 50 };

let origFetch;
beforeEach(() => {
  origFetch = globalThis.fetch;
  delete process.env.GROQ_API_KEY;
  delete process.env.AXON_TRIAL_GROQ_API_KEY;
  delete process.env.AXON_TRIAL_MODEL;
});
const restore = () => (globalThis.fetch = origFetch);

test("trial: GET reports availability from the env key only", async () => {
  assert.deepEqual(await (await trial(new Request(URL_))).json(), { available: false });
  process.env.GROQ_API_KEY = "gsk_test";
  assert.deepEqual(await (await trial(new Request(URL_))).json(), { available: true });
});

test("trial: off without a key; wrong method rejected", async () => {
  assert.equal((await trial(post(good))).status, 503);
  process.env.GROQ_API_KEY = "gsk_test";
  assert.equal((await trial(new Request(URL_, { method: "PUT" }))).status, 405);
});

test("trial: relays to Groq with the server-side key, caps tokens, never echoes the key", async () => {
  process.env.GROQ_API_KEY = "gsk_secret";
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi there" } }] }), { status: 200 });
  };
  try {
    const res = await trial(post({ ...good, maxTokens: 999999, evil: "ignored" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { text: "hi there" });
    assert.ok(!text.includes("gsk_secret"));
    assert.equal(seen.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(seen.init.headers.Authorization, "Bearer gsk_secret");
    assert.equal(seen.body.max_tokens, 1200);
    assert.equal(seen.body.messages[0].role, "system");
    assert.ok(!("evil" in seen.body));
  } finally { restore(); }
});

test("trial: rejects cross-site callers, bad bodies and oversized input", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  globalThis.fetch = async () => { throw new Error("must not be called"); };
  try {
    assert.equal((await trial(post(good, { Origin: "https://evil.example" }))).status, 403);
    assert.equal((await trial(post("not json"))).status, 400);
    assert.equal((await trial(post({ messages: [] }))).status, 400);
    assert.equal((await trial(post({ messages: [{ role: "system", content: "x" }] }))).status, 400);
    assert.equal((await trial(post({ messages: [{ role: "user", content: "x".repeat(50_000) }] }))).status, 413);
    // same-origin passes the gate; the (mocked) upstream then throws, which maps to 504
    assert.equal((await trial(post(good, { Origin: "https://axon.example.test" }))).status, 504);
  } finally { restore(); }
});

test("trial: falls back once if the preferred model is gone; maps upstream errors", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  const models = [];
  globalThis.fetch = async (_u, init) => {
    const m = JSON.parse(init.body).model;
    models.push(m);
    return m === "llama-3.3-70b-versatile"
      ? new Response("{}", { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const res = await trial(post(good, { "x-nf-client-connection-ip": "2.2.2.2" }));
    assert.equal(res.status, 200);
    assert.deepEqual(models, ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]);

    globalThis.fetch = async () => new Response("{}", { status: 401 });
    assert.equal((await trial(post(good, { "x-nf-client-connection-ip": "3.3.3.3" }))).status, 502);
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    assert.equal((await trial(post(good, { "x-nf-client-connection-ip": "4.4.4.4" }))).status, 429);
  } finally { restore(); }
});

test("trial: per-client rate limit kicks in", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  try {
    let last;
    for (let i = 0; i < 30; i++) last = await trial(post(good, { "x-nf-client-connection-ip": "9.9.9.9" }));
    assert.equal(last.status, 429);
    assert.equal((await trial(post(good, { "x-nf-client-connection-ip": "8.8.8.8" }))).status, 200);
  } finally { restore(); }
});
