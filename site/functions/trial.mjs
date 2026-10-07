/**
 * trial.mjs — the ONLY server code in AXON. A thin, stateless relay that lets
 * visitors try the app on a shared Groq key without ever seeing that key.
 *
 *   GET  /api/trial  → { available: boolean }
 *   POST /api/trial  → { text }        body: { system?, messages[], maxTokens? }
 *
 * It stores nothing, logs nothing about message content, rejects cross-site
 * callers, caps request size/output, and rate-limits per client (best effort —
 * serverless instances are short-lived, so this is a speed bump, not a vault).
 *
 * Config (Netlify → Site settings → Environment variables):
 *   GROQ_API_KEY       required to switch the trial on
 *   AXON_TRIAL_MODEL   optional, default llama-3.3-70b-versatile
 */

const UPSTREAM = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "llama-3.1-8b-instant";

const MAX_BODY_CHARS = 40_000;
const MAX_MESSAGES = 14;
const MAX_OUTPUT_TOKENS = 1200;
const RATE_LIMIT = 24; // requests…
const RATE_WINDOW_MS = 60_000; // …per minute, per client

const buckets = new Map();

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });

const getKey = () => (process.env.GROQ_API_KEY || process.env.AXON_TRIAL_GROQ_API_KEY || "").trim();

function limited(id, now = Date.now()) {
  const hits = (buckets.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  buckets.set(id, hits);
  if (buckets.size > 500) for (const [k, v] of buckets) if (!v.some((t) => now - t < RATE_WINDOW_MS)) buckets.delete(k);
  return hits.length > RATE_LIMIT;
}

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin GETs and non-browser tools send none
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

function clean(body) {
  if (!body || typeof body !== "object") return null;
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length) return null;
  const system = typeof body.system === "string" ? body.system : "";
  const total = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  if (total > MAX_BODY_CHARS) return { tooLong: true };
  const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 800, 8), MAX_OUTPUT_TOKENS);
  return { system, messages, maxTokens };
}

async function callGroq(model, { system, messages, maxTokens }, key) {
  return fetch(UPSTREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
    }),
    signal: AbortSignal.timeout(45_000),
  });
}

export default async function handler(req) {
  const key = getKey();

  if (req.method === "GET") return json({ available: Boolean(key) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  if (!key) return json({ error: "The free trial isn't switched on for this site." }, 503);
  if (!sameOrigin(req)) return json({ error: "Cross-site requests aren't allowed." }, 403);

  const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "anon").split(",")[0].trim();
  if (limited(ip)) return json({ error: "You're going a bit fast. Wait a few seconds and try again." }, 429, { "Retry-After": "10" });

  let payload;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS + 2000) return json({ error: "That message is too long for the free trial." }, 413);
    payload = clean(JSON.parse(raw));
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  if (!payload) return json({ error: "Bad request." }, 400);
  if (payload.tooLong) return json({ error: "That message is too long for the free trial." }, 413);

  const preferred = (process.env.AXON_TRIAL_MODEL || DEFAULT_MODEL).trim();
  try {
    let res = await callGroq(preferred, payload, key);
    // If the preferred model was retired/renamed, quietly fall back once.
    if ((res.status === 400 || res.status === 404) && preferred !== FALLBACK_MODEL) {
      res = await callGroq(FALLBACK_MODEL, payload, key);
    }
    if (res.status === 401 || res.status === 403) return json({ error: "The free trial key was rejected. The site owner needs to refresh it." }, 502);
    if (res.status === 429) return json({ error: "The free trial is busy right now. Try again in a moment." }, 429, { "Retry-After": "15" });
    if (!res.ok) return json({ error: "The AI service had a problem. Please try again." }, 502);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return json({ error: "The AI service sent back something unexpected." }, 502);
    return json({ text });
  } catch {
    return json({ error: "Couldn't reach the AI service. Please try again." }, 504);
  }
}

export const config = { path: "/api/trial" };
