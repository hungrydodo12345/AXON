/**
 * vault.js — the whole "database": one encrypted file the user carries.
 *
 * File format (.axon, UTF-8 JSON):
 *   {
 *     "format": "axon-vault", "version": 1,
 *     "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "<b64>" },
 *     "cipher": "AES-256-GCM", "compression": "gzip" | "none", "iv": "<b64>",
 *     "data": "<b64 ciphertext>"
 *   }
 * Everything except `data` is the header; the header bytes are bound to the
 * ciphertext as GCM "additional data", so tampering with any header field makes
 * decryption fail. The revision number and timestamps live INSIDE the encrypted
 * payload (and in the filename), so the file itself reveals nothing but its size.
 *
 * Runs unchanged in browsers and Node 20+ (Web Crypto + CompressionStream).
 */

import { uid } from "./utils.js";

export const FORMAT = "axon-vault";
export const FORMAT_VERSION = 1;
export const KDF_ITERATIONS = 600_000;
const MIN_ITER = 100_000;
const MAX_ITER = 5_000_000;
export const MAX_VAULT_BYTES = 40 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

// ── base64 helpers (chunked so big vaults don't blow the call stack) ──
function toB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeThrough(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// ── key derivation ──
export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw", enc.encode(String(passphrase).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the key can't be read back out of memory by page code
    ["encrypt", "decrypt"]
  );
}

/** Start a brand-new encryption session (new random salt) for a passphrase. */
export async function newSession(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  return { key, salt, iterations: KDF_ITERATIONS };
}

// ── vault shape ──
export function createEmptyVault(name = "") {
  const now = new Date().toISOString();
  return {
    schema: 1,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    profile: { name: String(name).slice(0, 80), myNames: [] },
    settings: {
      preset: "custom",
      needs: { literal: false, explainTone: true, labelEmotions: false, short: false, gentle: true },
      theme: "auto",
      textSize: "m",
    },
    provider: {
      mode: "none", // "none" | "trial" | "custom"
      preset: "groq",
      kind: "openai", // "openai" | "anthropic" | "gemini"
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      apiKey: "", // only kept if the user ticks "remember inside my vault"
      remember: false,
    },
    people: [],
    messages: [],
    summaries: {},
    tour: { done: false },
  };
}

/** Make any parsed vault safe to use: fill missing fields, drop junk. */
export function normalizeVault(raw) {
  if (!raw || typeof raw !== "object") throw new VaultError("corrupt", "The vault is empty or damaged.");
  const base = createEmptyVault();
  const v = { ...base, ...raw };
  v.profile = { ...base.profile, ...(raw.profile || {}) };
  v.settings = { ...base.settings, ...(raw.settings || {}) };
  v.settings.needs = { ...base.settings.needs, ...(raw.settings?.needs || {}) };
  v.provider = { ...base.provider, ...(raw.provider || {}) };
  v.tour = { ...base.tour, ...(raw.tour || {}) };
  v.people = Array.isArray(raw.people) ? raw.people.filter((p) => p && p.id && p.name) : [];
  v.messages = Array.isArray(raw.messages) ? raw.messages.filter((m) => m && m.id && typeof m.text === "string") : [];
  v.summaries = raw.summaries && typeof raw.summaries === "object" ? raw.summaries : {};
  v.revision = Number.isFinite(raw.revision) ? raw.revision : 0;
  return v;
}

// ── seal / open ──
export async function seal(vault, session) {
  const json = JSON.stringify(vault);
  let bytes = enc.encode(json);
  let compression = "none";
  if (typeof CompressionStream !== "undefined") {
    bytes = await pipeThrough(bytes, new CompressionStream("gzip"));
    compression = "gzip";
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: FORMAT,
    version: FORMAT_VERSION,
    kdf: { name: "PBKDF2-SHA256", iterations: session.iterations, salt: toB64(session.salt) },
    cipher: "AES-256-GCM",
    compression,
    iv: toB64(iv),
  };
  const aad = enc.encode(JSON.stringify(header));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, session.key, bytes);
  return JSON.stringify({ ...header, data: toB64(new Uint8Array(ct)) });
}

/** Quick structural check before asking for a passphrase. */
export function peekVault(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new VaultError("not_vault", "That doesn't look like an AXON vault file.");
  }
  if (!file || file.format !== FORMAT || typeof file.data !== "string") {
    throw new VaultError("not_vault", "That doesn't look like an AXON vault file.");
  }
  if (file.version > FORMAT_VERSION) {
    throw new VaultError("too_new", "This vault was saved by a newer version of AXON. Please update the site and try again.");
  }
  const it = file.kdf?.iterations;
  if (!Number.isInteger(it) || it < MIN_ITER || it > MAX_ITER || typeof file.kdf?.salt !== "string") {
    throw new VaultError("corrupt", "This vault file is damaged (bad key settings).");
  }
  return file;
}

export async function openVault(text, passphrase) {
  const file = peekVault(text);
  const { data, ...header } = file;
  let salt, iv, ct;
  try {
    salt = fromB64(file.kdf.salt);
    iv = fromB64(file.iv);
    ct = fromB64(data);
  } catch {
    throw new VaultError("corrupt", "This vault file is damaged.");
  }
  const key = await deriveKey(passphrase, salt, file.kdf.iterations);
  let plain;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(JSON.stringify(header)) }, key, ct)
    );
  } catch {
    throw new VaultError("bad_passphrase", "That passphrase doesn't open this vault — or the file has been changed or damaged.");
  }
  try {
    if (file.compression === "gzip") plain = await pipeThrough(plain, new DecompressionStream("gzip"));
    const vault = normalizeVault(JSON.parse(dec.decode(plain)));
    return { vault, session: { key, salt, iterations: file.kdf.iterations } };
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("corrupt", "The vault opened but its contents are damaged.");
  }
}

// ── naming ──
const pad = (n) => String(n).padStart(2, "0");

export function vaultFileName(vault, now = new Date()) {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `axon-vault_r${vault.revision}_${stamp}.axon`;
}

/** Passphrase quality hint — length is what matters, so reward long phrases. */
export function passphraseStrength(p) {
  const len = [...String(p)].length;
  if (len < 8) return { level: 0, label: "Too short — use at least 8 characters" };
  if (len < 12) return { level: 1, label: "Okay — longer is stronger" };
  if (len < 16) return { level: 2, label: "Good" };
  return { level: 3, label: "Strong" };
}
