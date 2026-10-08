/**
 * ui/tour.js — an interactive walkthrough that spotlights the real interface.
 * Works with zero AI configured: it loads a pre-analysed example message.
 */

import { h } from "../utils.js";
import { app, emit, mutate, setView, subscribe } from "../state.js";
import { addSample, hasSample, removeSample } from "../sample.js";
import { toast } from "./common.js";

let layer = null;
let stepIndex = 0;
let unsub = null;

function ensureSample({ select = true } = {}) {
  let created;
  mutate((v) => { created = addSample(v); }, { render: false });
  if (select) {
    app.view = "inbox";
    app.inboxFilter = "todo";
    app.selectedMessageId = created.message.id;
  }
  emit();
}

const STEPS = [
  {
    id: "welcome", center: true,
    title: "Welcome to AXON",
    body: ["This one-minute tour shows you around using a made-up example, so you don't need to connect anything first.", "You can leave at any time, and replay it later from Settings."],
  },
  {
    id: "vault", target: "#vault-chip",
    before: () => setView("inbox"),
    title: "Your vault is one file",
    body: ["Nothing you add is kept on a server. Everything lives in this tab until you press Save, which downloads your vault as a file.", "The number is the revision. It goes up each time you save, so higher is always newer. Next visit, open your latest file."],
  },
  {
    id: "add", target: "#add-message-btn",
    before: () => setView("inbox"),
    title: "Add a message",
    body: ["Paste a message here, or import a WhatsApp chat export. People are added for you automatically.", "Let's load an example so you can see what comes back."],
    actions: () => [{ label: "Load the example", kind: "primary", run: () => ensureSample() }],
    nextLabel: "Skip, I'll add my own",
  },
  {
    id: "tone", target: "#tone-card",
    before: () => ensureSample(),
    title: "How it sounds",
    body: ["AXON points at the exact words behind its read and tells you how sure it is. Low confidence means it's a coin flip.", "It's always a best guess. For anything important, you can ask the person."],
  },
  {
    id: "replies", target: "#replies-card",
    before: () => ensureSample(),
    title: "Reply ideas, written as you",
    body: ["Three drafts: warm, short, and a kind “not right now”. Edit one if you like, then tap Copy and paste it into your chat app.", "When you've dealt with the message, tap “I replied” and it moves to Done."],
  },
  {
    id: "people", target: "#nav-people",
    before: () => setView("people"),
    title: "People, remembered",
    body: ["Everyone you hear from appears here, grouped as Work or Personal. Add how you know them and a few notes, and AXON reads their messages with that context.", "Open someone to write “the story so far” of your history together."],
  },
  {
    id: "map", target: "#nav-map",
    before: () => { ensureSample({ select: false }); setView("map"); },
    title: "Your map",
    body: ["Everything connects here: the people in your life, the topics you keep returning to, what's waiting on you, and what helps with each person. It's drawn from your own messages, on your device.", "Drag to rotate it in 3D, or switch to Flat or List for a calmer view."],
  },
  {
    id: "ask", target: "#nav-ask",
    before: () => setView("ask"),
    title: "Ask your own memory",
    body: ["Try questions like “What's the story with Sam?” or “Who am I waiting to reply to?”. AXON looks things up in your vault and shows how it found the answer.", "Search finds messages by keyword on your device, with no AI needed."],
  },
  {
    id: "ai", target: "#provider-card",
    before: () => setView("settings"),
    title: "Pick your AI",
    body: ["AXON works with any provider: Groq, OpenAI, Claude, Gemini, OpenRouter, or a model on your own computer. Your key stays in memory unless you choose to keep it in your encrypted vault.", "You can try it free here first, or skip this and connect later."],
    actions: () => (app.trial.available && app.vault.provider.mode !== "trial"
      ? [{ label: "Use the free trial", kind: "primary", run: () => { mutate((v) => { v.provider.mode = "trial"; }); toast("Free trial connected."); } }]
      : []),
  },
  {
    id: "save", target: "#save-btn",
    before: () => setView("inbox"),
    title: "Save to keep your work",
    body: ["Press Save whenever you finish. You'll get a file like axon-vault_r1_2026-10-07_1430.axon. Keep it somewhere safe, and open it next time.", "Want it on this device too? Settings can install AXON for offline use and, if you choose, keep an encrypted copy here. Your passphrase is the only key. Nobody can recover it for you."],
    final: true,
  },
];

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function startTour() {
  if (layer) return;
  stepIndex = 0;
  app.tourActive = true;
  layer = {
    blocker: h("div", { class: "tour-blocker", "aria-hidden": "true" }),
    spot: h("div", { class: "tour-spot none", "aria-hidden": "true" }),
    card: h("div", { class: "tour-card placed", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title", "aria-describedby": "tour-body", id: "tour-card" }),
  };
  document.body.append(layer.blocker, layer.spot, layer.card);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, { passive: true });
  unsub = subscribe(() => requestAnimationFrame(position));
  show(0);
}

export function endTour({ markDone = true } = {}) {
  if (!layer) return;
  layer.blocker.remove(); layer.spot.remove(); layer.card.remove();
  layer = null;
  app.tourActive = false;
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("focusin", onFocusIn, true);
  window.removeEventListener("resize", position);
  window.removeEventListener("scroll", position);
  unsub?.(); unsub = null;
  if (markDone && app.vault && !app.vault.tour.done) mutate((v) => { v.tour.done = true; }, { render: false });
  app.view = app.view || "inbox";
  emit();
  document.getElementById("main")?.focus({ preventScroll: true });
}

function onKey(e) {
  if (!layer) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endTour(); }
  else if (e.key === "ArrowRight" && !isTyping(e)) { e.preventDefault(); next(); }
  else if (e.key === "ArrowLeft" && !isTyping(e)) { e.preventDefault(); back(); }
}
const isTyping = (e) => /^(input|textarea|select)$/i.test(e.target?.tagName ?? "");
function onFocusIn(e) {
  if (layer && !layer.card.contains(e.target)) layer.card.querySelector("button.primary, button")?.focus({ preventScroll: true });
}

async function show(i) {
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
  scrolledFor = -1;
  const step = STEPS[stepIndex];
  if (step.before) step.before();
  await nextFrame();
  if (!layer) return;
  const target = step.target ? document.querySelector(step.target) : null;
  if (target && target.getBoundingClientRect().width > 0) target.scrollIntoView({ block: "center", behavior: "auto" });
  paintCard(step);
  await nextFrame();
  position();
  (layer?.card.querySelector("h2"))?.focus({ preventScroll: true });
}

function paintCard(step) {
  const extra = step.actions ? step.actions() : [];
  const last = stepIndex === STEPS.length - 1;
  layer.card.replaceChildren(...[
    h("div", { class: "tour-progress", "aria-hidden": "true" }, STEPS.map((_, i) => h("i", { class: i <= stepIndex ? "done" : "" }))),
    h("div", { class: "muted tiny", text: `Step ${stepIndex + 1} of ${STEPS.length}` }),
    h("h2", { id: "tour-title", tabindex: "-1", text: step.title }),
    h("div", { id: "tour-body", class: "stack tight" }, step.body.map((t) => h("p", { text: t }))),
    extra.length ? h("div", { class: "row wrap" }, extra.map((a) => h("button", { type: "button", class: `btn ${a.kind ?? ""}`, onclick: async () => { await a.run(); paintCard(step); position(); } }, a.label))) : null,
    last && hasSample(app.vault) ? h("label", { class: "check", for: "tour-rm" },
      h("input", { type: "checkbox", id: "tour-rm", checked: true }),
      h("span", { class: "small", text: "Remove the example message and person when I finish" })) : null,
    h("div", { class: "tour-actions" },
      h("button", { type: "button", class: "btn ghost", onclick: () => endTour() }, "Skip tour"),
      h("div", { class: "right" },
        stepIndex > 0 ? h("button", { type: "button", class: "btn", onclick: back }, "Back") : null,
        h("button", { type: "button", class: "btn primary", id: "tour-next", onclick: last ? finish : next }, last ? "Finish" : step.nextLabel && !extra.length ? step.nextLabel : "Next"))),
  ].filter(Boolean));
}

function next() { if (stepIndex < STEPS.length - 1) show(stepIndex + 1); }
function back() { if (stepIndex > 0) show(stepIndex - 1); }
function finish() {
  const rm = document.getElementById("tour-rm");
  const remove = rm?.checked;
  endTour();
  if (remove && app.vault) {
    mutate((v) => removeSample(v), { render: false });
    app.selectedMessageId = null; app.selectedPersonId = null;
    emit();
  }
  toast("You're set. Add your first message whenever you're ready.");
}

let scrolledFor = -1;

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Highlight the target, then put the card wherever it doesn't cover it. */
function position() {
  if (!layer) return;
  const step = STEPS[stepIndex];
  const target = step.target ? document.querySelector(step.target) : null;
  const r = target?.getBoundingClientRect();
  const { spot, card } = layer;
  if (!r || r.width === 0 || r.height === 0 || step.center) {
    spot.classList.add("none");
    card.className = "tour-card middle";
    card.style.left = ""; card.style.top = ""; card.style.transform = "";
    return;
  }
  const pad = 6;
  spot.classList.remove("none");
  spot.style.left = `${Math.max(0, r.left - pad)}px`;
  spot.style.top = `${Math.max(0, r.top - pad)}px`;
  spot.style.width = `${Math.min(window.innerWidth, r.width + pad * 2)}px`;
  spot.style.height = `${Math.min(window.innerHeight, r.height + pad * 2)}px`;

  card.className = "tour-card placed";
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 12;
  const hole = { left: r.left - pad - 4, right: r.right + pad + 4, top: r.top - pad - 4, bottom: r.bottom + pad + 4 };
  const spots = [
    { left: (vw - cw) / 2, top: vh - ch - m },
    { left: (vw - cw) / 2, top: m },
    { left: m, top: vh - ch - m },
    { left: vw - cw - m, top: vh - ch - m },
    { left: m, top: m },
    { left: vw - cw - m, top: m },
  ].filter((c) => c.left >= 0 && c.left + cw <= vw);
  const clear = spots.find((c) => !intersects({ left: c.left, right: c.left + cw, top: c.top, bottom: c.top + ch }, hole));
  if (!clear && scrolledFor !== stepIndex) {
    // Nowhere clear (a tall target on a small screen): bring its top into view above the bottom card.
    scrolledFor = stepIndex;
    window.scrollBy(0, r.top - 76);
    requestAnimationFrame(position);
  }
  const pick = clear ?? spots[0] ?? { left: m, top: vh - ch - m };
  card.style.left = `${Math.round(pick.left)}px`;
  card.style.top = `${Math.round(pick.top)}px`;
  card.style.transform = "none";
}
