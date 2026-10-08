import { h, fmtWhen, fmtAgo, pluralize, clip } from "../utils.js";
import { app, mutate, emit, setView, personById } from "../state.js";
import { messagesFor } from "../search.js";
import { isConfigured } from "../providers.js";
import { runSummary, cancelBusy } from "../actions.js";
import { icon, chip, avatar, emptyState, spinner, confirmDialog, toast } from "./common.js";
import { uid } from "../utils.js";
import { normalizeSupport } from "../graph-data.js";
import { openPersonDialog } from "./dialogs.js";
import { addMessageFlow, openMessage } from "./inbox.js";

function stats(p) {
  const ms = messagesFor(app.vault, p.id);
  return { count: ms.length, last: ms.length ? ms[ms.length - 1].ts : null, ms };
}

export function renderPeople() {
  const v = app.vault;
  const root = h("div", { class: "view", id: "view-people" });
  const q = app.peopleQuery.trim().toLowerCase();

  root.append(h("div", { class: "view-head" },
    h("h1", { text: "People" }),
    h("button", { type: "button", class: "btn primary", id: "add-person-btn", onclick: () => openPersonDialog({ onSaved: (p) => { app.selectedPersonId = p.id; emit(); } }) }, icon("plus"), "Add person")));

  if (!v.people.length) {
    root.append(h("div", { class: "card" }, emptyState({
      iconName: "users",
      title: "No one here yet",
      body: "People are added automatically when you add a message from them. You can also add someone yourself, with a note on how you know them.",
      actions: [h("button", { type: "button", class: "btn primary", onclick: () => openPersonDialog({ onSaved: (p) => { app.selectedPersonId = p.id; emit(); } }) }, icon("plus"), "Add someone")],
    })));
    return root;
  }

  const selected = app.selectedPersonId ? personById(app.selectedPersonId) : null;
  const split = h("div", { class: "split", dataset: { pane: selected ? "detail" : "list" } });
  const listCol = h("div", { class: "list-col" });

  const search = h("input", { class: "input", id: "people-search", type: "search", placeholder: "Search people", "aria-label": "Search people", autocomplete: "off", value: app.peopleQuery,
    oninput: (e) => { app.peopleQuery = e.target.value; emit(); } });
  listCol.append(search);

  const matches = v.people.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.relationship || "").toLowerCase().includes(q));
  for (const [cat, label] of [["work", "Work"], ["personal", "Personal"]]) {
    const group = matches.filter((p) => (p.category === "work" ? "work" : "personal") === cat)
      .map((p) => ({ p, s: stats(p) }))
      .sort((a, b) => new Date(b.s.last ?? 0) - new Date(a.s.last ?? 0) || a.p.name.localeCompare(b.p.name));
    listCol.append(h("div", { class: "group-label" }, h("span", { text: label }), h("span", { text: String(group.length) })));
    if (!group.length) { listCol.append(h("p", { class: "hint", text: q ? "No matches." : cat === "work" ? "No work contacts yet." : "No personal contacts yet." })); continue; }
    listCol.append(h("ul", { class: "list", "aria-label": `${label} people` }, group.map(({ p, s }) => h("li", {},
      h("button", { type: "button", class: "list-item", "aria-current": String(app.selectedPersonId === p.id), id: `person-${p.id}`,
        onclick: () => { app.selectedPersonId = p.id; emit(); window.scrollTo({ top: 0 }); } },
        avatar(p.name),
        h("div", { class: "li-main" },
          h("div", { class: "li-top" }, h("span", { class: "li-name", text: p.name }), h("span", { class: "li-when", text: s.last ? fmtWhen(s.last) : "" })),
          h("div", { class: "li-snippet", text: p.relationship || (s.count ? pluralize(s.count, "message") : "No messages yet") })))))));
  }

  root.dataset.pane = selected ? "detail" : "list";
  split.append(listCol, h("div", { class: "detail" }, selected ? personDetail(selected) : h("div", { class: "card flat" }, emptyState({ iconName: "users", title: "Pick someone", body: "See your history together, your notes, and a short “story so far”." }))));
  root.append(split);
  return root;
}

function personDetail(p) {
  const { count, last, ms } = stats(p);
  const key = `summary:${p.id}`;
  const busy = app.busy.has(key);
  const err = app.errors[key];
  const sum = app.vault.summaries[p.id];
  const configured = isConfigured(app.vault.provider);
  const loops = ms.filter((m) => m.direction === "in" && m.needsReply === true && m.status !== "replied" && m.status !== "dismissed");

  const wrap = h("div", { class: "stack" });
  wrap.append(h("div", { class: "stack tight" },
    h("div", {}, h("button", { type: "button", class: "btn ghost sm back-btn", onclick: () => { app.selectedPersonId = null; emit(); } }, icon("back"), "All people")),
    h("div", { class: "row" },
      avatar(p.name, "lg"),
      h("div", { class: "grow" },
        h("h2", { text: p.name }),
        h("div", { class: "row wrap" }, chip(p.category === "work" ? "Work" : "Personal", "accent"), p.relationship ? chip(p.relationship) : null)),
      h("button", { type: "button", class: "btn sm", onclick: () => openPersonDialog({ person: p }) }, icon("edit"), "Edit"))));

  wrap.append(h("div", { class: "card" },
    h("dl", { class: "kv" },
      h("dt", { text: "Messages" }), h("dd", { text: count ? `${count.toLocaleString()}` : "None yet" }),
      h("dt", { text: "Last contact" }), h("dd", { text: last ? `${fmtAgo(last)} (${fmtWhen(last)})` : "—" }),
      h("dt", { text: "Your notes" }), h("dd", { text: p.notes || "No notes yet. Edit to add some." }))));

  if (loops.length) {
    wrap.append(h("div", { class: "card soft" },
      h("div", { class: "card-title" }, icon("clock"), "Waiting for your reply"),
      h("div", { class: "stack tight" }, loops.slice(-3).map((m) => h("button", { type: "button", class: "hit", onclick: () => openMessage(m.id) }, h("span", { class: "muted tiny", text: fmtWhen(m.ts) }), h("div", { text: clip(m.text.replace(/\s+/g, " "), 140) }))))));
  }

  wrap.append(supportsCard(p));

  // story so far
  const story = h("section", { class: "card", "aria-label": "The story so far" },
    h("div", { class: "card-title" }, icon("sparkle"), "The story so far"));
  if (busy) {
    story.append(h("div", { class: "stack" }, h("div", { class: "row" }, spinner(), "Reading your history…"), h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("button", { type: "button", class: "btn sm", onclick: () => cancelBusy(key) }, "Cancel")));
  } else {
    if (sum) {
      story.append(h("p", { text: sum.story }),
        sum.open_loops?.length ? [h("h3", { text: "Still open" }), h("ul", {}, sum.open_loops.map((x) => h("li", { text: x })))] : null,
        sum.remember?.length ? [h("h3", { style: null, text: "Worth remembering" }), h("ul", {}, sum.remember.map((x) => h("li", { text: x })))] : null,
        h("p", { class: "hint", text: `Written ${fmtAgo(sum.at)} from ${pluralize(sum.basedOn, "message")}. A best guess from your messages, not a fact.` }));
    } else {
      story.append(h("p", { class: "muted", text: count ? "A short, kind summary of your history with them, what's still open, and small things worth remembering." : "Add or import some messages first and AXON can write this." }));
    }
    if (err) story.append(h("div", { class: "err", role: "alert", text: err }));
    story.append(h("div", { class: "row wrap" },
      h("button", { type: "button", class: sum ? "btn" : "btn primary", disabled: !count || !configured, id: "summary-btn", onclick: () => runSummary(p.id) }, icon(sum ? "refresh" : "sparkle"), sum ? "Refresh the story" : "Write the story so far"),
      !configured ? h("button", { type: "button", class: "link-btn", onclick: () => setView("settings") }, "Connect an AI first") : h("span", { class: "hint", text: "Sends up to 40 recent messages with this person to your AI." })));
  }
  wrap.append(story);

  // timeline
  const tl = h("section", { class: "card", "aria-label": "Conversation" },
    h("div", { class: "card-title" }, "Conversation"));
  if (!ms.length) tl.append(h("p", { class: "muted", text: "No messages with them yet." }));
  else {
    const recent = ms.slice(-30);
    if (ms.length > recent.length) tl.append(h("p", { class: "hint", text: `Showing the latest ${recent.length} of ${ms.length.toLocaleString()}.` }));
    tl.append(h("div", { class: "bubble-list" }, recent.map((m) =>
      h("div", { class: `bubble ${m.direction === "out" ? "out" : ""}` },
        h("span", { class: "b-meta", text: `${m.direction === "out" ? "You" : p.name.split(/\s+/)[0]} · ${fmtWhen(m.ts)}` }),
        clip(m.text, 600)))));
  }
  tl.append(h("div", { class: "row wrap" },
    h("button", { type: "button", class: "btn", onclick: () => addMessageFlow(p.id) }, icon("plus"), `Add a message ${"with " + p.name.split(/\s+/)[0]}`)));
  wrap.append(tl);

  wrap.append(h("div", { class: "row" }, h("span", { class: "grow" }),
    h("button", { type: "button", class: "btn ghost sm danger", onclick: () => deletePerson(p, count) }, icon("trash"), "Delete person")));
  return wrap;
}

async function deletePerson(p, count) {
  const ok = await confirmDialog({
    title: `Delete ${p.name}?`,
    message: count ? `This also removes their ${pluralize(count, "message")} from your vault. It can't be undone once you save.` : "They'll be removed from your vault.",
    confirmLabel: "Delete", danger: true,
  });
  if (!ok) return;
  mutate((v) => {
    v.people = v.people.filter((x) => x.id !== p.id);
    v.messages = v.messages.filter((m) => m.personId !== p.id);
    delete v.summaries[p.id];
  });
  app.selectedPersonId = null;
  if (app.selectedMessageId && !app.vault.messages.some((m) => m.id === app.selectedMessageId)) app.selectedMessageId = null;
  emit();
  toast(`${p.name} was removed.`);
}

const SUPPORT_SUGGESTIONS = [
  "Needs time to reply",
  "Prefers text to calls",
  "Give me a heads-up before calls",
  "Short replies are fine",
  "Things in writing, please",
  "Plan ahead, not last minute",
  "Check in gently if I go quiet",
  "Quiet places to meet",
];

function addSupport(personId, text) {
  const clean = String(text).trim().slice(0, 80);
  if (!clean) return;
  mutate((v) => {
    const p = v.people.find((x) => x.id === personId);
    if (!p) return;
    p.supports = p.supports ?? [];
    if (!p.supports.some((s) => normalizeSupport(s.text) === normalizeSupport(clean))) p.supports.push({ id: uid(), text: clean });
  });
}

function supportsCard(p) {
  const first = p.name.split(/\s+/)[0];
  const have = p.supports ?? [];
  const input = h("input", { class: "input", id: "support-input", type: "text", maxlength: "80", autocomplete: "off", placeholder: "Something that helps, in your own words…", "aria-label": `Add something that helps with ${first}`,
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addSupport(p.id, input.value); } } });
  const suggestions = SUPPORT_SUGGESTIONS.filter((t) => !have.some((s) => normalizeSupport(s.text) === normalizeSupport(t)));
  return h("section", { class: "card stack tight", id: "supports-card", "aria-labelledby": "supports-h" },
    h("div", { class: "card-title", id: "supports-h" }, icon("shield"), `What helps with ${first}`),
    h("p", { class: "muted small", text: "Your own accommodations for this relationship. AXON shapes reply ideas around them, and they show up on your map." }),
    have.length
      ? h("ul", { class: "chips support-list", "aria-label": "What helps" }, have.map((s) => h("li", { class: "support-item" },
          h("span", { text: s.text }),
          h("button", { type: "button", class: "support-remove", "aria-label": `Remove “${s.text}”`, onclick: () => mutate((v) => { const x = v.people.find((q) => q.id === p.id); if (x) x.supports = x.supports.filter((q) => q.id !== s.id); }) }, icon("x")))))
      : h("p", { class: "hint", text: "Nothing added yet." }),
    h("div", { class: "row" }, h("div", { class: "grow" }, input), h("button", { type: "button", class: "btn", id: "support-add", onclick: () => addSupport(p.id, input.value) }, icon("plus"), "Add")),
    suggestions.length ? h("div", { class: "chips", role: "group", "aria-label": "Suggestions" }, suggestions.slice(0, 5).map((t) => h("button", { type: "button", class: "chip-btn", onclick: () => addSupport(p.id, t) }, `+ ${t}`))) : null);
}
