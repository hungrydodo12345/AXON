/**
 * ui/common.js — icons, toasts, dialogs and small shared widgets.
 * (No innerHTML anywhere — see utils.js.)
 */

import { h, uid } from "../utils.js";

// ── icons (Feather-style strokes) ──
const SVG_NS = "http://www.w3.org/2000/svg";
const PATHS = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  ask: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  settings: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4",
  plus: "M12 5v14 M5 12h14",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  back: "M19 12H5 M12 19l-7-7 7-7",
  trash: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  edit: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeoff: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M14.12 14.12a3 3 0 1 1-4.24-4.24 M1 1l22 22",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 16l.7 1.9L21.6 18.6l-1.9.7L19 21.2l-.7-1.9-1.9-.7 1.9-.7z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  chevron: "M9 18l6-6-6-6",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
};

export function icon(name, extraClass = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon ${extraClass}`.trim());
  for (const d of (PATHS[name] ?? "").split(/(?= M)/)) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d.trim());
    svg.append(p);
  }
  return svg;
}

// ── toast ──
let toastTimer = null;
export function toast(message, { kind = "info", ms = 4200 } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  // One calm message at a time: a new one replaces the old.
  clearTimeout(toastTimer);
  const el = h("div", { class: `toast ${kind === "error" ? "error" : ""}`, role: kind === "error" ? "alert" : "status", title: "Click to dismiss", onclick: () => el.remove() },
    icon(kind === "error" ? "alert" : "check"), h("span", { text: message }));
  host.replaceChildren(el);
  toastTimer = setTimeout(() => el.remove(), kind === "error" ? Math.max(ms, 7000) : ms);
}

// ── dialog ──
/**
 * @returns {{close:(result?:any)=>void, el:HTMLDialogElement, body:HTMLElement, foot:HTMLElement, closed:Promise<any>}}
 */
export function openDialog({ title, body, actions = [], wide = false, onClose, dismissible = true, initialFocus = null }) {
  const prevFocus = document.activeElement;
  const titleId = `dlg-${uid()}`;
  const dlg = h("dialog", { "aria-labelledby": titleId });
  const bodyEl = h("div", { class: "dialog-body" }, body);
  const footEl = h("div", { class: "dialog-foot" });
  let resolve;
  const closed = new Promise((r) => (resolve = r));
  let result;
  let done = false;

  const close = (res) => {
    if (done) return;
    done = true;
    result = res;
    if (dlg.open) dlg.close();
    dlg.remove();
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
    else document.getElementById("main")?.focus?.({ preventScroll: true });
    onClose?.(result);
    resolve(result);
  };

  for (const a of actions) {
    const btn = h("button", {
      type: "button",
      class: `btn ${a.kind ?? ""}`.trim(),
      id: a.id,
      onclick: async () => {
        if (btn.disabled) return;
        if (a.onClick) {
          btn.disabled = true;
          try {
            const r = await a.onClick({ close, button: btn });
            if (r === false) return; // keep open
            close(r ?? a.value);
          } finally { btn.disabled = false; }
        } else close(a.value);
      },
    }, a.icon ? icon(a.icon) : null, a.label);
    footEl.append(btn);
  }
  if (!actions.length) footEl.classList.add("hidden");

  dlg.append(h("div", { class: `dialog-box ${wide ? "wide" : ""}` },
    h("div", { class: "dialog-head" },
      h("h2", { id: titleId, text: title }),
      dismissible ? h("button", { type: "button", class: "btn ghost icon-only sm", "aria-label": "Close", onclick: () => close(undefined) }, icon("x")) : null),
    bodyEl, footEl));

  dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (dismissible) close(undefined); });
  dlg.addEventListener("click", (e) => { if (dismissible && e.target === dlg) close(undefined); });
  document.body.append(dlg);
  dlg.showModal();
  // focus the first field, else the first button — never the close "X"
  const first = (initialFocus && bodyEl.querySelector(initialFocus)) || bodyEl.querySelector("input, textarea, select, button:not([disabled])") || footEl.querySelector("button");
  first?.focus();
  return { close, el: dlg, body: bodyEl, foot: footEl, closed };
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return openDialog({
    title,
    body: h("div", { class: "stack" }, ...(Array.isArray(message) ? message : [message]).map((m) => (typeof m === "string" ? h("p", { text: m }) : m))),
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, kind: danger ? "danger solid" : "primary", value: true },
    ],
  }).closed.then((v) => v === true);
}

// ── widgets ──
export function chip(text, variant = "", iconName = null) {
  return h("span", { class: `chip ${variant}`.trim() }, iconName ? icon(iconName) : null, text);
}

const AVATAR_COLORS = ["", "c1", "c2", "c3", "c4", "c5"];
export function avatar(name, size = "") {
  const initial = (String(name ?? "?").trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();
  let sum = 0;
  for (const ch of String(name)) sum += ch.codePointAt(0);
  return h("div", { class: `avatar ${size} ${AVATAR_COLORS[sum % AVATAR_COLORS.length]}`.trim(), "aria-hidden": "true", text: initial });
}

export function field({ label, hint, id, control, optional = false }) {
  return h("div", { class: "field" },
    label ? h("label", { for: id }, label, optional ? h("span", { class: "muted", text: " (optional)" }) : null) : null,
    control,
    hint ? h("div", { class: "hint", id: `${id}-hint`, text: hint }) : null);
}

export function switchRow({ id, title, hint, checked, onChange }) {
  const input = h("input", { type: "checkbox", role: "switch", id, checked: !!checked, "aria-describedby": hint ? `${id}-d` : null, onchange: (e) => onChange(e.target.checked) });
  return h("label", { class: "switch-row", for: id },
    h("span", { class: "grow" }, h("strong", { text: title }), hint ? h("span", { class: "hint", id: `${id}-d`, text: hint }) : null),
    h("span", { class: "switch" }, input, h("span")));
}

export function segmented({ label, options, value, onChange }) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    options.map((o) => h("button", { type: "button", "aria-pressed": String(o.value === value), onclick: () => onChange(o.value) }, o.label)));
}

export function emptyState({ iconName = "inbox", title, body, actions = [] }) {
  return h("div", { class: "empty" },
    h("div", { class: "empty-icon" }, icon(iconName)),
    h("h2", { text: title }),
    body ? h("p", { text: body }) : null,
    actions.length ? h("div", { class: "row wrap", style: null }, actions) : null);
}

export function spinner() {
  return h("span", { class: "spinner", role: "presentation" });
}

/** Keep textarea height matching its content. */
export function autosize(ta) {
  const fit = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return ta;
}

export function privacyNote(text) {
  return h("div", { class: "note ok row", style: null }, icon("shield"), h("span", { text }));
}
