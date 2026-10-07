/**
 * ui/dialogs.js — add-message, import, person, and passphrase dialogs.
 */

import { h, uid, hashStr, readFileText, pluralize, clip } from "../utils.js";
import { app, mutate, emit, changePassphrase, personById } from "../state.js";
import { parseWhatsAppExport } from "../whatsapp.js";
import { isConfigured } from "../providers.js";
import { passphraseStrength } from "../vault.js";
import { icon, openDialog, field, segmented, toast, spinner } from "./common.js";

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function findOrCreatePerson(vault, name, category = "personal") {
  const clean = String(name).trim().slice(0, 80) || "Unknown";
  const existing = vault.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const p = { id: uid(), name: clean, category, relationship: "", notes: "", createdAt: new Date().toISOString() };
  vault.people.push(p);
  return p;
}

/**
 * Add-message dialog with two tabs. `onAdded(message, {analyze})` runs after saving.
 */
export function openAddMessage({ presetPersonId = null, onAdded } = {}) {
  let tab = "paste";
  const body = h("div", { class: "stack" });
  const dlgRef = {};

  const pasteState = { who: presetPersonId ? personById(presetPersonId)?.name ?? "" : "", direction: "in", text: "", when: toLocalInput(new Date()), analyze: true };
  let waState = { parsed: null, senders: [], me: "", fileName: "" };

  function render() {
    body.replaceChildren(
      h("div", { class: "row" }, segmented({
        label: "How to add",
        options: [{ value: "paste", label: "Paste a message" }, { value: "wa", label: "WhatsApp chat" }],
        value: tab,
        onChange: (v) => { tab = v; render(); updateActions(); },
      })),
      tab === "paste" ? pasteForm() : whatsappForm());
  }

  // ── paste ──
  function pasteForm() {
    const who = h("input", { class: "input", id: "am-who", type: "text", list: "am-people", autocomplete: "off", maxlength: "80", value: pasteState.who, placeholder: "e.g. Morgan", oninput: (e) => (pasteState.who = e.target.value) });
    const list = h("datalist", { id: "am-people" }, app.vault.people.map((p) => h("option", { value: p.name })));
    const text = h("textarea", { class: "textarea", id: "am-text", rows: "6", maxlength: "20000", placeholder: "Paste the message here…", oninput: (e) => (pasteState.text = e.target.value) });
    text.value = pasteState.text;
    const when = h("input", { class: "input", id: "am-when", type: "datetime-local", value: pasteState.when, oninput: (e) => (pasteState.when = e.target.value) });
    const ai = isConfigured(app.vault.provider);
    const analyze = h("input", { type: "checkbox", id: "am-ai", checked: ai && pasteState.analyze, disabled: !ai, onchange: (e) => (pasteState.analyze = e.target.checked) });
    return h("div", { class: "stack", id: "am-paste" },
      h("div", { class: "field" }, h("span", { class: "label", text: "This message was…" }),
        segmented({ label: "Direction", options: [{ value: "in", label: "Sent to me" }, { value: "out", label: "Sent by me" }], value: pasteState.direction, onChange: (v) => { pasteState.direction = v; render(); } })),
      field({ label: pasteState.direction === "in" ? "Who sent it?" : "Who was it sent to?", id: "am-who", control: who }), list,
      field({ label: "The message", id: "am-text", control: text }),
      field({ label: "When was it sent?", id: "am-when", control: when, hint: "Defaults to now.", optional: true }),
      h("label", { class: "check", for: "am-ai" }, analyze,
        h("span", {}, h("strong", { text: "Make sense of it right away" }),
          ai ? null : h("span", { class: "hint", text: "Connect an AI in Settings to turn this on." }))),
      pasteState.direction === "in" && ai ? h("p", { class: "hint", text: "The text of this message (and a little context about the sender) is sent to your chosen AI." }) : null);
  }

  // ── whatsapp ──
  function whatsappForm() {
    const picker = h("input", { type: "file", accept: ".txt,text/plain", id: "wa-file", class: "sr-only", tabindex: "-1" });
    const paste = h("textarea", { class: "textarea", id: "wa-paste", rows: "4", placeholder: "…or paste the exported text here", oninput: (e) => parse(e.target.value, "pasted text") });
    const status = h("div", { id: "wa-status", "aria-live": "polite" });

    picker.addEventListener("change", async () => {
      const f = picker.files?.[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) { waState = { parsed: null, senders: [], me: "", fileName: "" }; status.replaceChildren(h("div", { class: "err", text: "That file is bigger than 30 MB. Try exporting a shorter chat." })); updateActions(); return; }
      parse(await readFileText(f), f.name);
    });

    function parse(raw, label) {
      const parsed = parseWhatsAppExport(raw);
      if (!parsed.length) {
        waState = { parsed: null, senders: [], me: "", fileName: "" };
        status.replaceChildren(h("div", { class: "err", role: "alert", text: "I couldn't find any messages in that. Expected WhatsApp's “Export chat” text file (without media)." }));
        updateActions();
        return;
      }
      const counts = new Map();
      for (const m of parsed) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
      const senders = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
      const remembered = app.vault.profile.myNames?.find((n) => counts.has(n)) ?? "";
      waState = { parsed, senders, me: remembered, fileName: label };
      renderStatus();
      updateActions();
    }

    function renderStatus() {
      const { parsed, senders, me } = waState;
      if (!parsed) return;
      const span = parsed.filter((m) => m.timestamp).map((m) => m.timestamp.getTime());
      const range = span.length ? `${new Date(Math.min(...span)).toLocaleDateString()} – ${new Date(Math.max(...span)).toLocaleDateString()}` : "";
      status.replaceChildren(
        h("div", { class: "note ok" }, `Found ${pluralize(parsed.length, "message")} from ${pluralize(senders.length, "person", "people")}${range ? ` (${range})` : ""}.`),
        h("fieldset", { class: "stack tight", style: null },
          h("legend", { class: "label", text: "Which one is you?" }),
          ...senders.map((s, i) => h("label", { class: "radio-card", for: `wa-me-${i}` },
            h("input", { type: "radio", name: "wa-me", id: `wa-me-${i}`, value: s.name, checked: me === s.name, onchange: () => { waState.me = s.name; updateActions(); } }),
            h("span", {}, h("strong", { text: s.name }), h("span", { class: "hint", text: ` · ${pluralize(s.n, "message")}` })))),
          h("label", { class: "radio-card", for: "wa-me-none" },
            h("input", { type: "radio", name: "wa-me", id: "wa-me-none", value: "", checked: me === "", onchange: () => { waState.me = ""; updateActions(); } }),
            h("span", { text: "None of these (add everyone as someone else)" }))),
        h("p", { class: "hint", text: "These messages are saved into your vault only. None of them are sent to an AI unless you open one and ask AXON to make sense of it." }));
    }

    const wrap = h("div", { class: "stack", id: "am-wa" },
      h("ol", { class: "small muted" },
        h("li", { text: "In WhatsApp, open a chat and choose Export chat → Without media." }),
        h("li", { text: "Save the .txt file, then choose it below. It's safe to re-import later: duplicates are skipped." })),
      picker,
      h("button", { type: "button", class: "drop", id: "wa-drop", onclick: () => picker.click() }, icon("upload"), h("strong", { text: waState.fileName ? `Chosen: ${waState.fileName}` : "Choose the exported .txt file" })),
      paste, status);
    if (waState.parsed) renderStatus();
    return wrap;
  }

  // ── actions ──
  function updateActions() {
    const btn = dlgRef.dlg?.foot.querySelector("#am-submit");
    if (!btn) return;
    if (tab === "paste") {
      btn.replaceChildren(icon("plus"), "Add message");
      btn.disabled = false;
    } else {
      btn.replaceChildren(icon("upload"), waState.parsed ? `Import ${waState.parsed.length.toLocaleString()} messages` : "Import chat");
      btn.disabled = !waState.parsed;
    }
  }

  async function submit() {
    if (tab === "paste") {
      const text = pasteState.text.trim();
      const who = pasteState.who.trim();
      if (!who) { toast("Please say who it's from (or to).", { kind: "error" }); document.getElementById("am-who")?.focus(); return false; }
      if (!text) { toast("Please paste the message first.", { kind: "error" }); document.getElementById("am-text")?.focus(); return false; }
      const ts = pasteState.when ? new Date(pasteState.when) : new Date();
      const message = { id: uid(), personId: "", direction: pasteState.direction, source: "paste", ts: (isNaN(ts) ? new Date() : ts).toISOString(), text, status: "new", needsReply: null, analysis: null };
      mutate((v) => {
        message.personId = findOrCreatePerson(v, who).id;
        v.messages.push(message);
      }, { render: false });
      const wantAnalysis = pasteState.direction === "in" && pasteState.analyze && isConfigured(app.vault.provider);
      onAdded?.(message, { analyze: wantAnalysis });
      pasteState.text = "";
      return true;
    }
    // WhatsApp import
    const { parsed, me } = waState;
    if (!parsed) return false;
    let added = 0, skipped = 0, newPeople = 0;
    const before = app.vault.people.length;
    mutate((v) => {
      const known = new Set(v.messages.map((m) => m.id));
      const personCache = new Map();
      // For a 1:1 chat the counterpart is "the other sender"; in groups each sender is their own person.
      const otherSenders = new Set(parsed.map((x) => x.sender).filter((s) => s !== me));
      const onlyCounterpart = otherSenders.size === 1 ? [...otherSenders][0] : null;
      let lastOther = [...otherSenders][0] ?? null; // in groups, my messages attach to whoever spoke last
      for (const m of parsed) {
        const isMe = me && m.sender === me;
        const ts = (m.timestamp ?? new Date(0)).toISOString();
        if (!isMe) lastOther = m.sender;
        const personName = isMe ? (onlyCounterpart ?? lastOther ?? m.sender) : m.sender;
        let p = personCache.get(personName);
        if (!p) { p = findOrCreatePerson(v, personName); personCache.set(personName, p); }
        const id = `wa_${hashStr(`${m.sender}|${ts}|${m.text}`)}`;
        if (known.has(id)) { skipped++; continue; }
        known.add(id);
        v.messages.push({ id, personId: p.id, direction: isMe ? "out" : "in", source: "whatsapp", imported: true, ts, text: clip(m.text, 20000), status: "new", needsReply: null, analysis: null });
        added++;
      }
      if (me && !v.profile.myNames.includes(me)) v.profile.myNames.push(me);
    });
    newPeople = app.vault.people.length - before;
    toast(`Imported ${pluralize(added, "message")}${newPeople ? ` and added ${pluralize(newPeople, "person", "people")}` : ""}${skipped ? ` · ${skipped.toLocaleString()} already in your vault` : ""}.`);
    return true;
  }

  render();
  dlgRef.dlg = openDialog({
    title: "Add a message",
    body,
    initialFocus: presetPersonId ? "#am-text" : "#am-who",
    actions: [
      { label: "Cancel", value: false },
      { id: "am-submit", label: "Add message", kind: "primary", onClick: async () => { const ok = await submit(); return ok ? true : false; } },
    ],
  });
  updateActions();
  return dlgRef.dlg;
}

// ── person ──
const REL_SUGGESTIONS = ["Partner", "Parent", "Sibling", "Child", "Friend", "Close friend", "Colleague", "Manager", "Client", "Neighbour", "Doctor", "Landlord"];

export function openPersonDialog({ person = null, category = "personal", onSaved } = {}) {
  const editing = !!person;
  const st = { name: person?.name ?? "", category: person?.category ?? category, relationship: person?.relationship ?? "", notes: person?.notes ?? "" };
  const body = h("div", { class: "stack" });
  function render() {
    const name = h("input", { class: "input", id: "pp-name", type: "text", maxlength: "80", value: st.name, autocomplete: "off", oninput: (e) => (st.name = e.target.value) });
    const rel = h("input", { class: "input", id: "pp-rel", type: "text", maxlength: "80", list: "pp-rels", value: st.relationship, placeholder: "e.g. sister, manager, college friend", autocomplete: "off", oninput: (e) => (st.relationship = e.target.value) });
    const notes = h("textarea", { class: "textarea", id: "pp-notes", rows: "4", maxlength: "1000", placeholder: "Anything that helps read their messages: how they usually write, what they care about, things to remember…", oninput: (e) => (st.notes = e.target.value) });
    notes.value = st.notes;
    body.replaceChildren(
      field({ label: "Name", id: "pp-name", control: name }),
      h("div", { class: "field" }, h("span", { class: "label", text: "Where do they fit?" }),
        segmented({ label: "Category", options: [{ value: "personal", label: "Personal" }, { value: "work", label: "Work" }], value: st.category, onChange: (v) => { st.category = v; render(); } })),
      field({ label: "How do you know them?", id: "pp-rel", control: rel, optional: true }),
      h("datalist", { id: "pp-rels" }, REL_SUGGESTIONS.map((r) => h("option", { value: r }))),
      field({ label: "Notes", id: "pp-notes", control: notes, optional: true, hint: "Stored only in your vault. Used as context when AXON reads their messages." }));
  }
  render();
  return openDialog({
    title: editing ? "Edit person" : "Add a person",
    body,
    initialFocus: "#pp-name",
    actions: [
      { label: "Cancel", value: false },
      { label: editing ? "Save" : "Add person", kind: "primary", onClick: () => {
        const name = st.name.trim();
        if (!name) { toast("Please give them a name.", { kind: "error" }); document.getElementById("pp-name")?.focus(); return false; }
        const clash = app.vault.people.find((p) => p.id !== person?.id && p.name.toLowerCase() === name.toLowerCase());
        if (clash) { toast(`You already have someone called ${clash.name}.`, { kind: "error" }); return false; }
        let saved;
        mutate((v) => {
          if (editing) {
            const p = v.people.find((x) => x.id === person.id);
            Object.assign(p, { name, category: st.category, relationship: st.relationship.trim(), notes: st.notes.trim() });
            delete p.sample;
            saved = p;
          } else {
            saved = { id: uid(), name, category: st.category, relationship: st.relationship.trim(), notes: st.notes.trim(), createdAt: new Date().toISOString() };
            v.people.push(saved);
          }
        });
        onSaved?.(saved);
        return true;
      } },
    ],
  });
}

// ── passphrase ──
export function openChangePassphrase() {
  const a = h("input", { class: "input", id: "cp-a", type: "password", autocomplete: "new-password" });
  const b = h("input", { class: "input", id: "cp-b", type: "password", autocomplete: "new-password" });
  const meter = h("div", { class: "meter", "data-level": "", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const meterText = h("div", { class: "hint", text: "At least 8 characters. Longer is stronger." });
  a.addEventListener("input", () => { const s = passphraseStrength(a.value); meter.dataset.level = a.value ? String(s.level) : ""; meterText.textContent = a.value ? s.label : "At least 8 characters. Longer is stronger."; });
  return openDialog({
    title: "Change passphrase",
    initialFocus: "#cp-a",
    body: h("div", { class: "stack" },
      h("div", { class: "note warn", text: "Your next saved file will use the new passphrase. Older files still need the old one. Nobody can recover a lost passphrase." }),
      field({ label: "New passphrase", id: "cp-a", control: a }), h("div", { class: "stack tight" }, meter, meterText),
      field({ label: "Type it again", id: "cp-b", control: b })),
    actions: [
      { label: "Cancel", value: false },
      { label: "Change passphrase", kind: "primary", onClick: async () => {
        if (a.value.length < 8) { toast("Use at least 8 characters.", { kind: "error" }); a.focus(); return false; }
        if (a.value !== b.value) { toast("The two passphrases don't match.", { kind: "error" }); b.focus(); return false; }
        await changePassphrase(a.value);
        emit();
        toast("Passphrase changed. Save your vault to use it.");
        return true;
      } },
    ],
  });
}

export { spinner };
