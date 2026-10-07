/**
 * state.js — all live state, in memory only.
 *
 * Nothing here is ever written to localStorage, cookies, IndexedDB or a server.
 * Closing the tab (or "Close vault") discards it all; the only copy that
 * survives is the encrypted file the user downloads.
 */

import { seal, vaultFileName, newSession, createEmptyVault } from "./vault.js";
import { downloadBlob } from "./utils.js";

export const app = {
  vault: null,
  session: null,
  dirty: false,
  fileName: null, // name of the file this vault was opened from / last saved as
  savedAt: null,
  view: "inbox", // inbox | people | ask | settings
  selectedMessageId: null,
  selectedPersonId: null,
  inboxFilter: "todo", // todo | all | done
  peopleQuery: "",
  askMode: "ask", // ask | search
  askDraft: "",
  askThread: [], // session-only Q&A; never saved
  trial: { checked: false, available: false },
  busy: new Set(), // message ids / "summary:<id>" currently calling the AI
  errors: {}, // per-key inline error text
  tourActive: false,
  inboxLimit: 100,
};

const subs = new Set();
const lightSubs = new Set();

export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
export const subscribeLight = (fn) => (lightSubs.add(fn), () => lightSubs.delete(fn));

/** Full re-render. */
export function emit() {
  for (const fn of subs) fn();
}

/** Mark changed without re-rendering the page (keeps typing focus intact). */
export function touch() {
  if (!app.vault) return;
  app.dirty = true;
  for (const fn of lightSubs) fn();
}

/** Change the vault, mark it unsaved, re-render. */
export function mutate(fn, { render = true } = {}) {
  if (!app.vault) return;
  fn(app.vault);
  app.dirty = true;
  if (render) emit();
  else for (const f of lightSubs) f();
}

export function setView(view, extra = {}) {
  app.view = view;
  Object.assign(app, extra);
  emit();
  window.scrollTo?.({ top: 0 });
}

export function applyAppearance() {
  const root = document.documentElement;
  const s = app.vault?.settings;
  if (s?.theme === "light" || s?.theme === "dark") root.dataset.theme = s.theme;
  else delete root.dataset.theme;
  root.dataset.size = s?.textSize === "s" || s?.textSize === "l" ? s.textSize : "m";
}

// ── opening / closing ──
export function startVault(vault, session, fileName = null) {
  app.vault = vault;
  app.session = session;
  app.dirty = false;
  app.fileName = fileName;
  app.savedAt = vault.updatedAt ? new Date(vault.updatedAt).getTime() : null;
  app.view = "inbox";
  app.selectedMessageId = null;
  app.selectedPersonId = null;
  app.inboxFilter = "todo";
  app.askThread = [];
  app.askDraft = "";
  app.errors = {};
  app.busy = new Set();
  app.inboxLimit = 100;
  applyAppearance();
  emit();
}

export async function createVault({ name, passphrase }) {
  const vault = createEmptyVault(name);
  const session = await newSession(passphrase);
  startVault(vault, session, null);
  app.dirty = true; // a brand-new vault has never been saved
  emit();
}

export function closeVault() {
  app.vault = null;
  app.session = null;
  app.dirty = false;
  app.fileName = null;
  app.savedAt = null;
  app.askThread = [];
  app.errors = {};
  app.busy = new Set();
  app.tourActive = false;
  applyAppearance();
  emit();
}

/** Seal + download. Returns the file name. The API key is dropped unless the user opted to keep it. */
export async function saveVault() {
  const v = app.vault;
  if (!v) throw new Error("No vault is open.");
  const prevRev = v.revision;
  const prevUpdated = v.updatedAt;
  v.revision = prevRev + 1;
  v.updatedAt = new Date().toISOString();
  try {
    const copy = structuredClone(v);
    if (!copy.provider.remember) copy.provider.apiKey = "";
    const text = await seal(copy, app.session);
    const name = vaultFileName(v);
    downloadBlob(name, new Blob([text], { type: "application/octet-stream" }));
    app.dirty = false;
    app.savedAt = Date.now();
    app.fileName = name;
    emit();
    return name;
  } catch (e) {
    v.revision = prevRev;
    v.updatedAt = prevUpdated;
    throw e;
  }
}

export async function changePassphrase(passphrase) {
  app.session = await newSession(passphrase);
  touch();
}

// ── lookups ──
export const personById = (id) => app.vault?.people.find((p) => p.id === id) ?? null;
export const messageById = (id) => app.vault?.messages.find((m) => m.id === id) ?? null;

export function isTodo(m) {
  if (m.direction !== "in" || m.status === "replied" || m.status === "dismissed") return false;
  if (m.needsReply === true) return true;
  return m.needsReply == null && !m.imported && !m.analysis; // freshly pasted, not looked at yet
}

export function todoCount() {
  return app.vault ? app.vault.messages.filter(isTodo).length : 0;
}
