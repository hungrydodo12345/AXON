import { h } from "../utils.js";
import { GUIDE } from "../guide.js";
import { openDialog } from "./common.js";

function renderItem(item) {
  if (Array.isArray(item)) return [h("strong", { text: item[0] }), item[1]];
  return item;
}

function renderBlock(b) {
  if (b.p) return h("p", { text: b.p });
  if (b.h) return h("h4", { text: b.h });
  if (b.ul) return h("ul", {}, b.ul.map((i) => h("li", {}, renderItem(i))));
  if (b.ol) return h("ol", {}, b.ol.map((i) => h("li", {}, renderItem(i))));
  if (b.note) return h("div", { class: "note" }, b.note);
  if (b.warn) return h("div", { class: "note warn" }, b.warn);
  return null;
}

export function openHelp({ section = "start", onTour } = {}) {
  const body = h("div", { class: "help-layout" });
  const toc = h("nav", { class: "help-toc", "aria-label": "Guide sections" });
  const content = h("div", { class: "help-body" });
  const select = h("select", { class: "select help-select", "aria-label": "Jump to section", onchange: (e) => go(e.target.value) },
    GUIDE.map((s) => h("option", { value: s.id, text: s.title })));

  const sections = new Map();
  for (const s of GUIDE) {
    const el = h("section", { id: `help-${s.id}`, "aria-labelledby": `help-h-${s.id}` },
      h("h3", { id: `help-h-${s.id}`, text: s.title }), s.blocks.map(renderBlock));
    sections.set(s.id, el);
    content.append(el);
    toc.append(h("button", { type: "button", dataset: { id: s.id }, onclick: () => go(s.id) }, s.title));
  }
  if (onTour) {
    toc.append(h("button", { type: "button", class: "btn sm", style: null, onclick: () => { dlg.close(); onTour(); } }, "Replay the tour"));
  }

  function go(id) {
    sections.get(id)?.scrollIntoView({ block: "start", behavior: "auto" });
    for (const b of toc.querySelectorAll("button[data-id]")) b.setAttribute("aria-current", String(b.dataset.id === id));
    select.value = id;
  }

  body.append(toc, h("div", {}, select, content));
  const dlg = openDialog({ title: "How AXON works", body, wide: true, actions: [{ label: "Done", kind: "primary", value: true }] });
  requestAnimationFrame(() => go(section));
  return dlg;
}
