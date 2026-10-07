import { h, fmtWhen, fmtFull, copyText, pluralize } from "../utils.js";
import { app, mutate, emit, setView, personById, messageById, isTodo, todoCount } from "../state.js";
import { isConfigured } from "../providers.js";
import { addSample } from "../sample.js";
import { runAnalysis } from "../actions.js";
import { cancelBusy } from "../actions.js";
import { icon, chip, avatar, emptyState, spinner, toast, segmented, autosize, confirmDialog } from "./common.js";
import { openAddMessage } from "./dialogs.js";

const PILE = { important: ["Important", "warn"], social: ["Social", "accent"], casual: ["Casual", ""], archive: ["FYI", ""] };
const REPLY_BY = { none: "No reply needed", today: "Reply today", this_week: "Reply this week", whenever: "Reply whenever" };
const TONE_VARIANT = { friendly: "ok", excited: "ok", joking: "ok", neutral: "accent", sarcastic: "warn", anxious: "warn", annoyed: "warn", upset: "warn", urgent: "warn", unclear: "" };
const STYLE_LABEL = { warm: "Warm", brief: "Short and simple", boundary: "Kind “not right now”" };

export function addMessageFlow(presetPersonId = null) {
  return openAddMessage({
    presetPersonId,
    onAdded: (message, { analyze }) => {
      if (message.direction === "in") {
        app.view = "inbox";
        app.selectedMessageId = message.id;
        app.inboxFilter = "todo";
        emit();
        if (analyze) runAnalysis(message.id);
      } else {
        emit();
        toast(`Added to ${personById(message.personId)?.name ?? "their"} history.`);
      }
    },
  });
}

export function openMessage(id) {
  app.view = "inbox";
  app.selectedMessageId = id;
  const m = messageById(id);
  if (m && m.direction === "in") {
    const inTodo = isTodo(m);
    if (app.inboxFilter === "todo" && !inTodo) app.inboxFilter = "all";
  }
  emit();
}

function visibleMessages() {
  const msgs = app.vault.messages;
  let list;
  if (app.inboxFilter === "todo") list = msgs.filter(isTodo);
  else if (app.inboxFilter === "done") list = msgs.filter((m) => m.direction === "in" && (m.status === "replied" || m.status === "dismissed"));
  else list = msgs.filter((m) => m.direction === "in");
  return list.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

export function renderInbox() {
  const v = app.vault;
  const root = h("div", { class: "view", id: "view-inbox" });
  const todo = todoCount();

  root.append(h("div", { class: "view-head" },
    h("h1", { text: "Inbox" }),
    segmented({
      label: "Filter messages",
      options: [{ value: "todo", label: `To do${todo ? ` (${todo})` : ""}` }, { value: "all", label: "All" }, { value: "done", label: "Done" }],
      value: app.inboxFilter,
      onChange: (f) => { app.inboxFilter = f; app.inboxLimit = 100; emit(); },
    }),
    h("button", { type: "button", class: "btn primary", id: "add-message-btn", onclick: () => addMessageFlow() }, icon("plus"), "Add message")));

  if (!v.messages.length) {
    root.append(h("div", { class: "card" }, emptyState({
      iconName: "inbox",
      title: "Nothing here yet",
      body: "Paste a message you've received and AXON will explain what it probably means and suggest calm ways to reply. Or load an example first to see how it works.",
      actions: [
        h("button", { type: "button", class: "btn primary", onclick: () => addMessageFlow() }, icon("plus"), "Add your first message"),
        h("button", { type: "button", class: "btn", id: "try-sample-btn", onclick: () => { let created; mutate((vault) => { created = addSample(vault); }, { render: false }); app.selectedMessageId = created.message.id; emit(); } }, icon("sparkle"), "Try an example"),
      ],
    })));
    return root;
  }

  const list = visibleMessages();
  const selected = app.selectedMessageId ? messageById(app.selectedMessageId) : null;
  const split = h("div", { class: "split", dataset: { pane: selected ? "detail" : "list" } });
  const listCol = h("div", { class: "list-col" });

  if (!list.length) {
    listCol.append(h("div", { class: "card flat" }, emptyState({
      iconName: "check",
      title: app.inboxFilter === "todo" ? "You're all caught up" : app.inboxFilter === "done" ? "Nothing marked done yet" : "No messages",
      body: app.inboxFilter === "todo" ? "Nothing is waiting for a reply. Add a message whenever you need a hand with one." : null,
    })));
  } else {
    const shown = list.slice(0, app.inboxLimit);
    listCol.append(h("ul", { class: "list", "aria-label": "Messages" }, shown.map((m) => h("li", {}, messageRow(m)))));
    if (list.length > shown.length) {
      listCol.append(h("button", { type: "button", class: "btn block", onclick: () => { app.inboxLimit += 100; emit(); } }, `Show more (${(list.length - shown.length).toLocaleString()} left)`));
    }
  }

  root.dataset.pane = selected ? "detail" : "list";
  split.append(listCol, h("div", { class: "detail", id: "msg-detail", "aria-live": "polite" }, selected ? messageDetail(selected) : h("div", { class: "card flat" }, emptyState({ iconName: "inbox", title: "Pick a message", body: "Choose one on the left to see what it probably means and how you might reply." }))));
  root.append(split);
  return root;
}

function messageRow(m) {
  const p = personById(m.personId);
  const a = m.analysis;
  const chips = [];
  if (a) chips.push(chip(PILE[a.pile]?.[0] ?? "Message", PILE[a.pile]?.[1] ?? ""));
  else if (m.imported) chips.push(chip("Imported"));
  else chips.push(chip("Not read yet", "warn"));
  if (m.status === "replied") chips.push(chip("Replied", "ok", "check"));
  if (m.sample) chips.push(chip("Example"));
  const name = p?.name ?? "Unknown";
  return h("button", {
    type: "button", class: "list-item", id: `msg-${m.id}`,
    "aria-current": String(app.selectedMessageId === m.id), "aria-label": `${name}, ${fmtWhen(m.ts)}: ${m.text.slice(0, 80)}`,
    onclick: () => { app.selectedMessageId = m.id; emit(); window.scrollTo({ top: 0 }); },
  },
    avatar(name),
    h("div", { class: "li-main" },
      h("div", { class: "li-top" }, h("span", { class: "li-name", text: name }), h("span", { class: "li-when", text: fmtWhen(m.ts) })),
      h("div", { class: "li-snippet", text: m.text }),
      h("div", { class: "li-chips" }, chips)));
}

function messageDetail(m) {
  const p = personById(m.personId);
  const a = m.analysis;
  const busy = app.busy.has(m.id);
  const err = app.errors[m.id];
  const configured = isConfigured(app.vault.provider);
  const out = m.direction === "out";

  const wrap = h("div", { class: "stack" });
  wrap.append(h("div", { class: "stack tight" },
    h("div", {}, h("button", { type: "button", class: "btn ghost sm back-btn", onclick: () => { app.selectedMessageId = null; emit(); } }, icon("back"), "All messages")),
    h("div", { class: "row" },
      avatar(p?.name ?? "?", "lg"),
      h("div", { class: "grow" },
        h("h2", { text: out ? `To ${p?.name ?? "Unknown"}` : p?.name ?? "Unknown" }),
        h("div", { class: "muted small", text: `${fmtFull(m.ts)}${m.source === "whatsapp" ? " · WhatsApp" : ""}` })),
      p ? h("button", { type: "button", class: "btn sm", onclick: () => setView("people", { selectedPersonId: p.id }) }, "Person") : null)));

  if (m.sample) wrap.append(h("div", { class: "note", text: "This is an example from the tour. Delete it any time (bottom of this page)." }));
  wrap.append(h("div", { class: `quote ${out ? "out" : ""}`, text: m.text, tabindex: "0", "aria-label": "Original message" }));

  if (out) {
    wrap.append(h("div", { class: "note", text: "This is a message you sent. It's kept as context for the conversation." }));
  } else if (!a) {
    wrap.append(h("div", { class: "card" },
      busy
        ? h("div", { class: "stack" },
            h("div", { class: "row" }, spinner(), h("strong", { text: "Reading it carefully…" })),
            h("div", { class: "skeleton" }), h("div", { class: "skeleton", style: null }), h("div", { class: "skeleton" }),
            h("button", { type: "button", class: "btn sm", onclick: () => cancelBusy(m.id) }, "Cancel"))
        : h("div", { class: "stack" },
            h("p", { text: m.imported ? "This message was imported and hasn't been read by an AI. Want AXON to make sense of it?" : "AXON hasn't looked at this one yet." }),
            err ? h("div", { class: "err", role: "alert", text: err }) : null,
            h("div", { class: "row wrap" },
              h("button", { type: "button", class: "btn primary", id: "analyze-btn", onclick: () => (configured ? runAnalysis(m.id) : setView("settings")) }, icon("sparkle"), configured ? "Make sense of this" : "Connect an AI to continue"),
              configured ? h("span", { class: "hint", text: "Sends this message to your chosen AI." }) : h("span", { class: "hint", text: "Takes a minute. The free trial needs no sign-up." })))));
  } else {
    wrap.append(...analysisCards(m, a));
    wrap.append(h("div", { class: "row wrap" },
      m.status === "replied" || m.status === "dismissed"
        ? [chip(m.status === "replied" ? "Marked as replied" : "No reply needed", "ok", "check"), h("button", { type: "button", class: "btn sm", onclick: () => setStatus(m.id, "new") }, "Undo")]
        : [
            h("button", { type: "button", class: "btn primary", id: "replied-btn", onclick: () => { setStatus(m.id, "replied"); toast("Marked as replied. Nice one."); } }, icon("check"), "I replied"),
            h("button", { type: "button", class: "btn", onclick: () => setStatus(m.id, "dismissed") }, "No reply needed"),
          ],
      h("span", { class: "grow" }),
      busy ? h("span", { class: "row" }, spinner(), "Re-reading…") : h("button", { type: "button", class: "btn ghost sm", onclick: () => runAnalysis(m.id), disabled: !configured, title: configured ? "" : "Connect an AI first" }, icon("refresh"), "Try again")));
    if (err) wrap.append(h("div", { class: "err", role: "alert", text: err }));
  }

  wrap.append(h("div", { class: "row" },
    h("span", { class: "grow" }),
    h("button", { type: "button", class: "btn ghost sm danger", onclick: () => deleteMessage(m) }, icon("trash"), "Delete message")));
  return wrap;
}

function setStatus(id, status) {
  mutate((v) => { const m = v.messages.find((x) => x.id === id); if (m) m.status = status; });
}

async function deleteMessage(m) {
  if (!(await confirmDialog({ title: "Delete this message?", message: "It's removed from your vault the next time you save. This can't be undone once saved.", confirmLabel: "Delete", danger: true }))) return;
  mutate((v) => { v.messages = v.messages.filter((x) => x.id !== m.id); });
  app.selectedMessageId = null;
  emit();
}

function analysisCards(m, a) {
  const cards = [];

  // at a glance
  cards.push(h("section", { class: "card", id: "glance-card", "aria-label": "At a glance" },
    h("div", { class: "card-title" }, icon("sparkle"), "At a glance"),
    h("p", { text: a.summary }),
    h("div", { class: "row wrap" },
      chip(PILE[a.pile]?.[0] ?? "Message", PILE[a.pile]?.[1] ?? ""),
      a.needs_reply ? chip(REPLY_BY[a.reply_by] ?? "Reply", a.reply_by === "today" ? "warn" : "accent", "clock") : chip("No reply needed", "ok", "check"))));

  if (a.plain_meaning) {
    cards.push(h("section", { class: "card", "aria-label": "What they probably mean" },
      h("div", { class: "card-title" }, "What they probably mean"),
      h("p", { text: a.plain_meaning })));
  }

  // tone
  const t = a.tone;
  cards.push(h("section", { class: "card", id: "tone-card", "aria-label": "How it sounds" },
    h("div", { class: "card-title" }, "How it sounds"),
    h("div", { class: "tone-line" },
      h("span", { class: "tone-label", text: t.label }),
      h("span", { class: `confidence ${t.confidence}`, text: `${t.confidence} confidence` })),
    t.evidence ? h("p", { text: t.evidence }) : null,
    a.reassurance ? h("div", { class: "note ok", text: a.reassurance }) : null,
    h("p", { class: "hint", text: "A best guess from the words alone, not a fact. If it matters, you can always ask them." })));

  if (a.asks.length || a.dates.length) {
    cards.push(h("section", { class: "card", "aria-label": "Asks and dates" },
      a.asks.length ? [h("div", { class: "card-title" }, "What they're asking"), h("ul", {}, a.asks.map((x) => h("li", { text: x })))] : null,
      a.dates.length ? [h("div", { class: "card-title", style: null }, "Dates and times mentioned"), h("div", { class: "chips" }, a.dates.map((d) => chip(d, "accent", "clock")))] : null));
  }

  if (a.replies.length) {
    cards.push(h("section", { class: "card", id: "replies-card", "aria-label": "Reply ideas" },
      h("div", { class: "card-title" }, "Reply ideas"),
      h("p", { class: "hint", text: "Written as you. Edit anything, then copy." }),
      h("div", { class: "stack tight" }, a.replies.map((r, i) => replyCard(r, i)))));
  }
  return cards;
}

function replyCard(r, i) {
  const ta = h("textarea", { class: "textarea", id: `reply-${i}`, rows: "2", "aria-label": `${STYLE_LABEL[r.style] ?? "Reply"} reply, editable` });
  ta.value = r.text;
  autosize(ta);
  const copy = h("button", { type: "button", class: "btn sm", onclick: async () => {
    const ok = await copyText(ta.value);
    toast(ok ? "Copied. Paste it into your chat app." : "Couldn't copy — select the text and copy it manually.", { kind: ok ? "info" : "error" });
  } }, icon("copy"), "Copy");
  return h("div", { class: "reply-card" },
    h("div", { class: "row between" }, h("span", { class: "reply-style", text: STYLE_LABEL[r.style] ?? "Reply" }), copy), ta);
}
