/**
 * providers.js — one tiny interface over any AI provider.
 *
 *   callModel(provider, { system, messages, maxTokens, signal }) → string
 *
 * Three wire formats cover essentially everything:
 *   "openai"    — OpenAI-compatible /chat/completions (Groq, OpenAI, OpenRouter,
 *                 Together, Mistral, DeepSeek, Ollama, LM Studio, vLLM, ...)
 *   "anthropic" — Anthropic Messages API
 *   "gemini"    — Google Gemini generateContent
 *
 * "Bring your own" calls go straight from the user's browser to their provider.
 * Only the free trial goes through this site's /api/trial proxy (which holds the
 * shared key so it never reaches the browser).
 */

export const PRESETS = [
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyHint: "Starts with gsk_", keyUrl: "https://console.groq.com/keys" },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "Starts with sk-", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-haiku-4-5-20251001", keyHint: "Starts with sk-ant-", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash", keyHint: "Starts with AIza", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keyHint: "Starts with sk-or-", keyUrl: "https://openrouter.ai/keys" },
  { id: "ollama", label: "Ollama (on your computer)", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keyHint: "No key needed", keyUrl: "https://ollama.com", local: true },
  { id: "lmstudio", label: "LM Studio (on your computer)", kind: "openai", baseUrl: "http://localhost:1234/v1", model: "local-model", keyHint: "No key needed", keyUrl: "https://lmstudio.ai", local: true },
  { id: "custom", label: "Other (OpenAI-compatible)", kind: "openai", baseUrl: "", model: "", keyHint: "Whatever your provider gives you", keyUrl: "" },
];

export const TRIAL_ENDPOINT = "/api/trial";
const TIMEOUT_MS = 60_000;
const TRIAL_LABEL = "The free trial";

export class ProviderError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "ProviderError";
    this.status = status; // HTTP status when the failure came from a response
    this.code = code; // "not_configured" | "auth" | "rate_limit" | "network" | "bad_response" | "aborted" | "trial_off"
  }
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

export function isConfigured(provider) {
  if (!provider) return false;
  if (provider.mode === "trial") return true;
  if (provider.mode !== "custom") return false;
  if (!provider.baseUrl || !provider.model) return false;
  const preset = presetById(provider.preset);
  return Boolean(provider.apiKey) || Boolean(preset.local);
}

export function describeProvider(provider) {
  if (provider?.mode === "trial") return "Free trial (Groq)";
  if (provider?.mode === "custom") {
    const p = presetById(provider.preset);
    return `${p.label} · ${provider.model}`;
  }
  return "No AI connected";
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return "the provider"; }
}

async function fetchJson(url, init, signal, label) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), TIMEOUT_MS);
  const onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener("abort", onAbort);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw new ProviderError("aborted", "Cancelled.");
    if (ctl.signal.aborted) throw new ProviderError("network", `${label} took too long to answer. Try again, or pick a faster model.`);
    throw new ProviderError(
      "network",
      `Couldn't reach ${hostOf(url)}. Check your internet connection${/localhost|127\.0\.0\.1/.test(url) ? ", that the local app is running, and that it allows requests from this site (CORS/origins)" : ""}.`
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const detail = body?.error?.message || body?.error || body?.message || "";
    const d = typeof detail === "string" ? detail : JSON.stringify(detail);
    // Our own relay already words its errors for humans — pass them through untouched.
    if (label === TRIAL_LABEL && typeof body?.error === "string") {
      throw new ProviderError(res.status === 429 ? "rate_limit" : "bad_response", body.error, res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("auth", `${label} rejected the key (${res.status}). Double-check it and that it has access to this model.${d ? ` Details: ${d.slice(0, 160)}` : ""}`, res.status);
    }
    if (res.status === 429) throw new ProviderError("rate_limit", `${label} says you're sending too fast or out of quota. Wait a moment and try again.`, 429);
    if (res.status === 404) throw new ProviderError("bad_response", `${label} doesn't know that model or address (404). Check the model name and base URL.${d ? ` Details: ${d.slice(0, 160)}` : ""}`, 404);
    throw new ProviderError("bad_response", `${label} returned an error (${res.status}).${d ? ` ${d.slice(0, 200)}` : ""}`, res.status);
  }
  return body;
}

// ── adapters ──
async function callOpenAI(p, { system, messages, maxTokens, signal }) {
  const headers = { "Content-Type": "application/json" };
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`;
  const body = await fetchJson(
    joinUrl(p.baseUrl, "chat/completions"),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: p.model,
        temperature: 0.3,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
      }),
    },
    signal,
    hostOf(p.baseUrl)
  );
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new ProviderError("bad_response", "The provider replied, but not in the expected format.");
  return text;
}

async function callAnthropic(p, { system, messages, maxTokens, signal }) {
  const body = await fetchJson(
    joinUrl(p.baseUrl || "https://api.anthropic.com", "v1/messages"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": p.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: p.model, max_tokens: maxTokens, temperature: 0.3, system, messages }),
    },
    signal,
    "Anthropic"
  );
  const text = (body?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (!text) throw new ProviderError("bad_response", "Anthropic replied with no text.");
  return text;
}

async function callGemini(p, { system, messages, maxTokens, signal }) {
  const base = p.baseUrl || "https://generativelanguage.googleapis.com";
  const body = await fetchJson(
    joinUrl(base, `v1beta/models/${encodeURIComponent(p.model)}:generateContent`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": p.apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
      }),
    },
    signal,
    "Gemini"
  );
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("");
  if (!text) throw new ProviderError("bad_response", "Gemini replied with no text (it may have blocked the request).");
  return text;
}

async function callTrial({ system, messages, maxTokens, signal }) {
  let body;
  try {
    body = await fetchJson(
      TRIAL_ENDPOINT,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, messages, maxTokens }) },
      signal,
      TRIAL_LABEL
    );
  } catch (e) {
    if (e instanceof ProviderError && (e.status === 404 || e.status === 503)) {
      throw new ProviderError("trial_off", "The free trial isn't switched on for this site. Connect your own AI in Settings instead.");
    }
    throw e;
  }
  if (typeof body?.text !== "string") throw new ProviderError("bad_response", "The free trial replied in an unexpected format.");
  return body.text;
}

const isLocalProvider = (p) => p.mode === "custom" && (Boolean(presetById(p.preset).local) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(p.baseUrl || ""));

export async function callModel(provider, req) {
  const r = { maxTokens: 1200, messages: [], ...req };
  if (!isConfigured(provider)) {
    throw new ProviderError("not_configured", "No AI is connected yet. Open Settings → AI and choose the free trial or your own provider.");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false && !isLocalProvider(provider)) {
    throw new ProviderError("network", "You're offline, so the AI can't be reached. Reading, searching, your people and the map all still work. Try again when you're back online.");
  }
  if (provider.mode === "trial") return callTrial(r);
  if (provider.kind === "anthropic") return callAnthropic(provider, r);
  if (provider.kind === "gemini") return callGemini(provider, r);
  return callOpenAI(provider, r);
}

/** Is the free-trial proxy available on this host? */
export async function checkTrial() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false; // no pointless failing request
  try {
    const res = await fetch(TRIAL_ENDPOINT, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.available === true;
  } catch {
    return false;
  }
}

export async function testConnection(provider, signal) {
  const started = performance.now();
  const reply = await callModel(provider, {
    system: "You are a connection test. Reply with exactly: OK",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 12,
    signal,
  });
  return { ms: Math.round(performance.now() - started), reply: reply.trim().slice(0, 40) };
}
