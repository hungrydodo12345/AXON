import { h, fmtFull, pluralize } from "../utils.js";
import { app, mutate, touch, emit, applyAppearance, saveVault, closeVault, deviceEnabled, enableDeviceCopy, disableDeviceCopy, saveDeviceCopy, flushDeviceSave } from "../state.js";
import { deviceStorageAvailable } from "../device.js";
import { installStatus } from "./install.js";
import { PRESETS, presetById, isConfigured, testConnection, describeProvider } from "../providers.js";
import { NEED_PRESETS, NEED_LABELS } from "../analyze.js";
import { hasSample, removeSample } from "../sample.js";
import { icon, field, switchRow, segmented, spinner, toast, chip, openDialog, confirmDialog } from "./common.js";
import { openChangePassphrase } from "./dialogs.js";
import { openHelp } from "./help.js";

let testState = null; // { pending } | { ok, ms } | { error }

export function renderSettings({ onTour } = {}) {
  const v = app.vault;
  const root = h("div", { class: "view stack loose", id: "view-settings" });
  root.append(h("div", { class: "view-head" }, h("h1", { text: "Settings" })));

  root.append(needsCard(v), providerCard(v), offlineCard(v), lookCard(v), vaultCard(v, onTour), privacyCard());
  return root;
}

// ── how AXON talks to you ──
function needsCard(v) {
  const s = v.settings;
  const sel = h("select", { class: "select", id: "preset-select", onchange: (e) => {
    const id = e.target.value;
    mutate((vault) => {
      vault.settings.preset = id;
      if (id !== "custom") vault.settings.needs = { ...NEED_PRESETS[id].needs };
    });
  } }, Object.entries(NEED_PRESETS).map(([id, p]) => h("option", { value: id, selected: s.preset === id, text: p.label })));
  return h("section", { class: "card", id: "needs-card", "aria-labelledby": "needs-h" },
    h("h2", { id: "needs-h", text: "How AXON talks to you" }),
    h("p", { class: "muted", text: "Pick a starting point, then change anything. These are comfort settings, not diagnoses." }),
    field({ label: "Starting point", id: "preset-select", control: sel }),
    h("div", { class: "stack tight" }, Object.entries(NEED_LABELS).map(([key, l]) =>
      switchRow({ id: `need-${key}`, title: l.title, hint: l.hint, checked: s.needs[key], onChange: (val) => {
        mutate((vault) => { vault.settings.needs[key] = val; vault.settings.preset = "custom"; }, { render: false });
        const sel2 = document.getElementById("preset-select");
        if (sel2) sel2.value = "custom";
      } }))),
    h("div", { class: "field" },
      h("label", { for: "name-input", text: "What should AXON call you?" }),
      h("input", { class: "input", id: "name-input", type: "text", maxlength: "60", value: v.profile.name, autocomplete: "off", oninput: (e) => { v.profile.name = e.target.value; touch(); } })));
}

// ── AI connection ──
function providerCard(v) {
  const p = v.provider;
  const trialOk = app.trial.available;
  const setMode = (mode) => { mutate((vault) => { vault.provider.mode = mode; }); testState = null; };

  const card = h("section", { class: "card stack", id: "provider-card", "aria-labelledby": "prov-h" },
    h("h2", { id: "prov-h", text: "AI connection" }),
    h("p", { class: "muted", text: "AXON works with any AI. Connected now: " + describeProvider(p) + "." }));

  const radio = (value, title, desc, { disabled = false } = {}) => h("label", { class: `radio-card ${disabled ? "disabled" : ""}`, for: `mode-${value}` },
    h("input", { type: "radio", name: "ai-mode", id: `mode-${value}`, value, checked: p.mode === value, disabled, onchange: () => setMode(value) }),
    h("span", {}, h("strong", { text: title }), h("span", { class: "hint", style: null, text: ` ${desc}` })));

  card.append(h("div", { class: "stack tight", role: "radiogroup", "aria-label": "AI connection type" },
    radio("trial", "Try it free", trialOk ? "A shared Groq connection hosted with this site. Rate-limited. Your message text passes through this site's relay (never stored)." : "Not switched on for this site.", { disabled: !trialOk }),
    radio("custom", "Use my own AI", "Messages go straight from your browser to your provider. Any provider works."),
    radio("none", "No AI for now", "You can still keep people and notes, and use Search.")));

  if (p.mode === "custom") card.append(customFields(v));
  return card;
}

function customFields(v) {
  const p = v.provider;
  const preset = presetById(p.preset);
  const box = h("div", { class: "stack", id: "custom-fields" });

  box.append(h("div", { class: "field" }, h("span", { class: "label", text: "Provider" }),
    h("div", { class: "provider-grid" }, PRESETS.map((pr) => h("button", { type: "button", class: "choice", "aria-pressed": String(p.preset === pr.id), onclick: () => {
      mutate((vault) => {
        const keepKey = vault.provider.apiKey;
        Object.assign(vault.provider, { preset: pr.id, kind: pr.kind, baseUrl: pr.baseUrl, model: pr.model, apiKey: pr.local ? "" : keepKey });
      });
      testState = null;
    } }, pr.label)))));

  const key = h("input", { class: "input", id: "api-key", type: "password", autocomplete: "off", spellcheck: "false", autocapitalize: "off", value: p.apiKey, placeholder: preset.local ? "Not needed" : preset.keyHint, disabled: !!preset.local,
    oninput: (e) => { p.apiKey = e.target.value.trim(); testState = null; touch(); } });
  const eye = h("button", { type: "button", class: "btn ghost sm icon-only", "aria-label": "Show or hide key", onclick: () => {
    const show = key.type === "password";
    key.type = show ? "text" : "password";
    eye.replaceChildren(icon(show ? "eyeoff" : "eye"));
  } }, icon("eye"));
  box.append(field({
    label: "API key", id: "api-key",
    control: h("div", { class: "input-group" }, key, preset.local ? null : eye),
    hint: preset.local ? "Local models need no key." : `${preset.keyHint}. ${preset.keyUrl ? "" : ""}`,
  }));
  if (preset.keyUrl && !preset.local) box.append(h("p", { class: "small", style: null }, h("a", { href: preset.keyUrl, target: "_blank", rel: "noopener noreferrer", text: `Where do I get a ${preset.label} key?` })));
  if (preset.local) box.append(h("div", { class: "note", text: `Make sure ${preset.label.split(" ")[0]} is running on your computer and allows requests from this website (for Ollama, set OLLAMA_ORIGINS to this site's address).` }));

  box.append(field({ label: "Model", id: "model-input", control: h("input", { class: "input", id: "model-input", type: "text", value: p.model, autocomplete: "off", spellcheck: "false", oninput: (e) => { p.model = e.target.value.trim(); testState = null; touch(); } }), hint: "The exact model name your provider uses." }));

  if (p.kind === "openai") {
    box.append(field({ label: "Base URL", id: "base-url", control: h("input", { class: "input", id: "base-url", type: "url", value: p.baseUrl, autocomplete: "off", spellcheck: "false", placeholder: "https://api.example.com/v1", oninput: (e) => { p.baseUrl = e.target.value.trim(); testState = null; touch(); } }), hint: "Usually ends in /v1. Pre-filled for the providers above." }));
  }

  box.append(h("label", { class: "check", for: "remember-key" },
    h("input", { type: "checkbox", id: "remember-key", checked: p.remember, onchange: (e) => mutate((vault) => { vault.provider.remember = e.target.checked; }, { render: false }) }),
    h("span", {}, h("strong", { text: "Remember my key inside my encrypted vault" }), h("span", { class: "hint", text: preset.local ? "" : " Off by default: your key then lives only in memory for this visit." }))));

  const result = h("div", { id: "test-result", "aria-live": "polite" });
  const paint = () => {
    result.replaceChildren();
    if (!testState) return;
    if (testState.pending) result.append(h("div", { class: "row" }, spinner(), "Testing…"));
    else if (testState.error) result.append(h("div", { class: "err", role: "alert", text: testState.error }));
    else result.append(h("div", { class: "note ok", text: `Connected — it answered in ${(testState.ms / 1000).toFixed(1)}s.` }));
  };
  paint();
  const testBtn = h("button", { type: "button", class: "btn", id: "test-btn", onclick: async () => {
    if (!isConfigured(app.vault.provider)) { testState = { error: preset.local ? "Fill in the model and base URL first." : "Add your API key and model first." }; paint(); return; }
    testState = { pending: true }; paint(); testBtn.disabled = true;
    try { testState = await testConnection(app.vault.provider); testState.ok = true; }
    catch (e) { testState = { error: e.message || "That didn't work." }; }
    testBtn.disabled = false; paint();
  } }, icon("check"), "Test connection");
  box.append(h("div", { class: "row wrap" }, testBtn), result,
    h("p", { class: "hint", text: `Messages you analyse go straight from this browser to ${preset.id === "custom" ? "your provider" : preset.label.split(" (")[0]}. They don't pass through this site's server.` }));
  return box;
}

// ── look & feel ──
function lookCard(v) {
  return h("section", { class: "card stack", "aria-labelledby": "look-h" },
    h("h2", { id: "look-h", text: "Look and feel" }),
    h("div", { class: "field" }, h("span", { class: "label", text: "Theme" }),
      segmented({ label: "Theme", options: [{ value: "auto", label: "Match my device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], value: v.settings.theme, onChange: (t) => { mutate((vault) => { vault.settings.theme = t; }); applyAppearance(); } })),
    h("div", { class: "field" }, h("span", { class: "label", text: "Text size" }),
      segmented({ label: "Text size", options: [{ value: "s", label: "Small" }, { value: "m", label: "Medium" }, { value: "l", label: "Large" }], value: v.settings.textSize, onChange: (t) => { mutate((vault) => { vault.settings.textSize = t; }); applyAppearance(); } })));
}

// ── vault ──
function vaultCard(v, onTour) {
  const nPeople = v.people.length, nMsgs = v.messages.length;
  return h("section", { class: "card stack", id: "vault-card", "aria-labelledby": "vault-h" },
    h("h2", { id: "vault-h", text: "Your vault" }),
    h("dl", { class: "kv" },
      h("dt", { text: "Revision" }), h("dd", { text: app.dirty ? `${v.revision} (+ unsaved changes)` : String(v.revision) }),
      h("dt", { text: "Last saved" }), h("dd", { text: v.revision ? fmtFull(v.updatedAt) : "Never — save it to keep your work" }),
      h("dt", { text: "Contents" }), h("dd", { text: `${pluralize(nPeople, "person", "people")}, ${pluralize(nMsgs, "message")}` }),
      h("dt", { text: "Opened from" }), h("dd", { text: app.fileName ?? "A new vault" })),
    h("div", { class: "row wrap" },
      h("button", { type: "button", class: "btn primary", id: "settings-save", onclick: doSave }, icon("download"), "Save a copy now"),
      h("button", { type: "button", class: "btn", onclick: openChangePassphrase }, icon("lock"), "Change passphrase"),
      h("button", { type: "button", class: "btn", onclick: onTour }, icon("help"), "Replay the tour"),
      h("button", { type: "button", class: "btn", onclick: () => openHelp() }, icon("file"), "Open the guide")),
    hasSample(v) ? h("div", { class: "row wrap" }, chip("Example data is in your vault", "warn"),
      h("button", { type: "button", class: "btn sm", onclick: () => { mutate((vault) => removeSample(vault)); app.selectedMessageId = null; app.selectedPersonId = null; emit(); toast("Example data removed."); } }, "Remove example data")) : null,
    h("div", { class: "row wrap" },
      h("button", { type: "button", class: "btn danger", id: "close-vault-btn", onclick: requestClose }, "Close vault")));
}

export async function doSave() {
  try {
    const name = await saveVault();
    toast(`Saved as ${name}. Keep this file safe — it's your vault.`);
    return true;
  } catch (e) {
    toast("Couldn't save: " + (e.message || e), { kind: "error" });
    return false;
  }
}

export async function requestClose() {
  await flushDeviceSave();
  if (!app.dirty) { closeVault(); toast("Vault closed. Everything was cleared from memory."); return; }
  const d = openDialog({
    title: "Save before closing?",
    body: h("p", { text: deviceEnabled() ? "Your latest changes are kept in the encrypted copy on this device, but they aren't in a vault file yet. Save a file too, to be safe." : "You have changes that aren't in a saved file yet. If you close without saving, they're gone." }),
    actions: [
      { label: "Cancel", value: "cancel" },
      { label: "Close without saving", kind: "danger", value: "discard" },
      { label: "Save, then close", kind: "primary", value: "save" },
    ],
  });
  const choice = await d.closed;
  if (choice === "discard") { closeVault(); toast("Vault closed without saving."); }
  else if (choice === "save") { if (await doSave()) { closeVault(); } }
}

function privacyCard() {
  return h("section", { class: "card soft stack tight", "aria-labelledby": "priv-h" },
    h("h2", { id: "priv-h" }, icon("shield"), " Privacy at a glance"),
    h("ul", {},
      h("li", { text: "Your vault is encrypted on this device with your passphrase (AES-256-GCM)." }),
      h("li", { text: "Nothing is stored on any server. No account, cookies, or tracking." }),
      h("li", { text: "Only the message you choose to analyse (plus a little context) is sent to your AI." }),
      h("li", { text: "Closing the vault clears everything from memory." })),
    h("button", { type: "button", class: "link-btn", onclick: () => openHelp({ section: "privacy" }) }, "Read the full privacy details"));
}

// ── offline + this device ──
function offlineCard(v) {
  const on = deviceEnabled();
  const available = deviceStorageAvailable();
  const when = app.device.savedAt ? fmtFull(app.device.savedAt) : null;
  return h("section", { class: "card stack", id: "offline-card", "aria-labelledby": "off-h" },
    h("h2", { id: "off-h", text: "Offline and this device" }),
    h("div", { class: "row" }, icon(app.pwa.offlineReady ? "check" : "clock"),
      h("span", { text: app.pwa.offlineReady ? "AXON is ready to work offline. Open your vault file with no connection and read, search and explore your map." : "Getting AXON ready for offline use… (needs a secure https connection)" })),
    installStatus(),
    h("div", { class: "stack tight" },
      switchRow({
        id: "device-copy", title: "Keep an encrypted copy on this device", checked: on,
        hint: available ? "Reopen your vault here without choosing a file, even offline. Off by default." : "This browser can't store a copy.",
        onChange: async (val) => {
          if (val) {
            const ok = await confirmDialog({
              title: "Keep an encrypted copy on this device?",
              message: [
                "AXON will store your vault in this browser, locked with your passphrase, and update it as you work.",
                "Anyone using this browser profile could see that a copy exists, but can't read it without your passphrase. Don't turn this on for a shared or public computer.",
                "Browsers can clear stored data, so keep saving vault files too.",
              ],
              confirmLabel: "Turn it on",
            });
            if (ok) { try { await enableDeviceCopy(); toast("Kept on this device, encrypted."); } catch (e) { toast(e.message, { kind: "error" }); } }
          } else {
            const ok = await confirmDialog({ title: "Remove the copy from this device?", message: "The saved copy in this browser is deleted. Your vault files are not touched.", confirmLabel: "Remove it", danger: true });
            if (ok) { await disableDeviceCopy(); toast("Removed from this device."); }
          }
          emit();
        },
      })),
    on ? h("div", { class: "row wrap" },
      app.device.status === "error" ? h("div", { class: "err", role: "alert", text: app.device.error }) : h("span", { class: "hint", text: when ? `Last kept on this device: ${when}.` : "Saving…" }),
      h("button", { type: "button", class: "btn sm", onclick: async () => { if (await saveDeviceCopy()) toast("Saved on this device."); else toast(app.device.error || "Couldn't save.", { kind: "error" }); emit(); } }, "Save now")) : null);
}
