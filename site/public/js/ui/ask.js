import { h, fmtWhen, clip, uid } from "../utils.js";
import { app, emit, setView, personById } from "../state.js";
import { isConfigured } from "../providers.js";
import { askVault, stepLabel } from "../agent.js";
import { searchMessages } from "../search.js";
import { icon, segmented, emptyState, spinner, toast, autosize } from "./common.js";
import { openMessage } from "./inbox.js";

let asking = null; // { id, controller } while a question is running

function examples() {
  const v = app.vault;
  const list = ["Who am I waiting to reply to?"];
  const p = [...v.people].sort((a, b) => {
    const la = v.messages.filter((m) => m.personId === a.id).length;
    const lb = v.messages.filter((m) => m.personId === b.id).length;
    return lb - la;
  })[0];
  if (p) list.push(`What's the story with ${p.name.split(/\s+/)[0]}?`, `What did ${p.name.split(/\s+/)[0]} say recently?`);
  list.push("What plans or deadlines are coming up?");
  return list;
}

export function renderAsk() {
  const v = app.vault;
  const configured = isConfigured(v.provider);
  const root = h("div", { class: "view", id: "view-ask" });

  root.append(h("div", { class: "view-head" },
    h("h1", { text: "Ask" }),
    segmented({ label: "Mode", options: [{ value: "ask", label: "Ask AXON" }, { value: "search", label: "Search" }], value: app.askMode, onChange: (m) => { app.askMode = m; emit(); } })));

  if (!v.messages.length) {
    root.append(h("div", { class: "card" }, emptyState({
      iconName: "ask", title: "Nothing to ask about yet",
      body: "Add or import some messages first. Then you can ask things like “What's the story with Sam?” or “Who am I waiting to reply to?”.",
      actions: [h("button", { type: "button", class: "btn primary", onclick: () => setView("inbox") }, "Go to Inbox")],
    })));
    return root;
  }

  if (app.askMode === "search") return renderSearch(root);

  const ta = h("textarea", { class: "textarea compact", id: "ask-input", rows: "2", maxlength: "600", placeholder: "Ask about a person or a conversation…", "aria-label": "Your question", style: null,
    oninput: (e) => (app.askDraft = e.target.value),
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } } });
  ta.value = app.askDraft;
  autosize(ta);
  const btn = h("button", { type: "button", class: "btn primary", id: "ask-btn", disabled: !!asking || !configured, onclick: submit }, asking ? spinner() : icon("ask"), asking ? "Looking…" : "Ask");

  root.append(h("div", { class: "card stack" },
    ta,
    h("div", { class: "row wrap" }, btn,
      configured ? h("span", { class: "hint", text: "Looks things up in your vault step by step. Shift+Enter for a new line." }) : h("span", { class: "hint" }, "Needs an AI. ", h("button", { type: "button", class: "link-btn", onclick: () => setView("settings") }, "Connect one in Settings"), " — or use Search, which needs none.")),
    h("div", { class: "chips", role: "group", "aria-label": "Example questions" }, examples().map((q) => h("button", { type: "button", class: "chip-btn", disabled: !configured, onclick: () => { app.askDraft = q; submit(q); } }, q)))));

  const thread = h("div", { class: "thread", "aria-live": "polite" });
  for (const turn of [...app.askThread].reverse()) thread.append(turnCard(turn));
  root.append(thread);
  return root;

  async function submit(override) {
    const question = String(typeof override === "string" ? override : app.askDraft).trim();
    if (!question || asking || !configured) return;
    const turn = { id: uid(), question, steps: [], answer: null, sources: [], error: null, pending: true };
    app.askThread.push(turn);
    app.askDraft = "";
    const controller = new AbortController();
    asking = { id: turn.id, controller };
    emit();
    try {
      const res = await askVault(app.vault, question, { signal: controller.signal, onStep: (s) => { turn.steps.push(s); if (app.view === "ask") emit(); } });
      turn.answer = res.answer; turn.sources = res.sources; turn.steps = res.steps;
    } catch (e) {
      turn.error = e?.code === "aborted" ? "Cancelled." : e?.message || "Something went wrong.";
    } finally {
      turn.pending = false;
      asking = null;
      if (app.vault) emit();
    }
  }
}

function turnCard(t) {
  const card = h("section", { class: "card stack tight", "aria-label": "Question and answer" },
    h("div", { class: "row" }, icon("ask"), h("strong", { class: "grow", text: t.question })));
  if (t.steps.length || t.pending) {
    card.append(h("ul", { class: "steps", "aria-label": "How I looked" }, t.steps.map((s) => h("li", {}, icon(s.ok ? "check" : "alert"), stepLabel(s))),
      t.pending ? h("li", {}, spinner(), "Thinking…") : null));
  }
  if (t.pending && asking?.id === t.id) card.append(h("div", {}, h("button", { type: "button", class: "btn sm", onclick: () => asking?.controller.abort() }, "Cancel")));
  if (t.error) card.append(h("div", { class: "err", role: "alert", text: t.error }));
  if (t.answer) {
    card.append(h("div", { class: "answer", text: t.answer }));
    if (t.sources.length) {
      card.append(h("div", { class: "card-title", style: null }, "Based on these messages"),
        h("div", { class: "stack tight" }, t.sources.map((id) => {
          const m = app.vault.messages.find((x) => x.id === id);
          if (!m) return null;
          const p = personById(m.personId);
          return h("button", { type: "button", class: "hit", onclick: () => openMessage(id) },
            h("span", { class: "muted tiny", text: `${p?.name ?? "Unknown"} · ${fmtWhen(m.ts)}${m.direction === "out" ? " · you" : ""}` }),
            h("div", { text: clip(m.text.replace(/\s+/g, " "), 160) }));
        })));
    }
    card.append(h("p", { class: "hint", text: "AXON only knows what's in your vault, and can get things wrong. Check the messages above for anything important." }));
  }
  return card;
}

function renderSearch(root) {
  const input = h("input", { class: "input", id: "search-input", type: "search", placeholder: "Search every message, person and note…", "aria-label": "Search your vault", autocomplete: "off", value: app.searchDraft,
    oninput: (e) => { app.searchDraft = e.target.value; paintResults(); } });
  const results = h("div", { class: "stack tight", "aria-live": "polite" });
  function paintResults() {
    results.replaceChildren();
    const q = app.searchDraft.trim();
    if (!q) { results.append(h("p", { class: "muted", text: "Type a few words. Search runs only on your device, needs no AI, and ranks the best matches first." })); return; }
    const hits = searchMessages(app.vault, q, { limit: 30 });
    if (!hits.length) { results.append(h("p", { class: "muted", text: "No messages matched. Try fewer or different words." })); return; }
    results.append(h("p", { class: "hint", text: `${hits.length}${hits.length === 30 ? "+" : ""} best matches` }));
    for (const m of hits) {
      const p = personById(m.personId);
      results.append(h("button", { type: "button", class: "hit", onclick: () => openMessage(m.id) },
        h("span", { class: "muted tiny", text: `${p?.name ?? "Unknown"} · ${fmtWhen(m.ts)}${m.direction === "out" ? " · you" : ""}` }),
        h("div", { text: clip(m.text.replace(/\s+/g, " "), 200) })));
    }
  }
  root.append(h("div", { class: "card stack" }, input, results));
  paintResults();
  return root;
}
