/**
 * ui/graph.js — "Map": an Obsidian-style graph of your people, topics, open
 * commitments and what helps with each person. 3D (drag to rotate), Flat, or
 * an accessible List. Hand-built on <canvas>; no libraries, nothing leaves the
 * device. Motion is opt-in (gentle spin) and off for reduced-motion users.
 */

import { h, pluralize, clip, fmtWhen } from "../utils.js";
import { app, mutate, emit, setView, personById, messageById } from "../state.js";
import { buildGraph, neighbours } from "../graph-data.js";
import { createLayout, makeView, project, fitView, nodeRadius } from "../graph-layout.js";
import { isConfigured } from "../providers.js";
import { labelTopics } from "../analyze.js";
import { icon, chip, segmented, emptyState, spinner, toast, openDialog, field } from "./common.js";
import { openMessage } from "./inbox.js";

const g = {
  mode: "3d", // 3d | flat | list
  filters: { topics: true, commitments: true, supports: true },
  view: makeView(),
  selectedId: null,
  hoverId: null,
  spin: false,
  layout: null,
  sig: "",
  fitted: false,
  graph: null,
  labelBusy: false,
  labelError: "",
  needsDraw: true,
};

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const SHAPE_NAME = { person: "circle", topic: "diamond", commitment: "square", support: "hexagon" };
const TYPE_NAME = { person: "Person", topic: "Topic", commitment: "Waiting on you", support: "What helps" };

export function renderMap() {
  const v = app.vault;
  const data = buildGraph(v, g.filters);
  g.graph = data;
  if (g.selectedId && !data.nodes.some((n) => n.id === g.selectedId)) g.selectedId = null;

  const root = h("div", { class: "view stack", id: "view-map" });
  root.append(h("div", { class: "view-head" },
    h("h1", { text: "Map" }),
    segmented({
      label: "How to show the map",
      options: [{ value: "3d", label: "3D" }, { value: "flat", label: "Flat" }, { value: "list", label: "List" }],
      value: g.mode,
      onChange: (m) => {
        g.mode = m;
        if (m !== "list") { g.view.mode = m; g.view.yaw = m === "flat" ? 0 : g.view.yaw; g.fitted = false; }
        g.needsDraw = true;
        emit();
      },
    })));

  const people = data.nodes.filter((n) => n.type === "person");
  if (people.length < 1 || data.nodes.length < 2) {
    root.append(h("div", { class: "card" }, emptyState({
      iconName: "graph",
      title: "Your map will grow as you add people",
      body: "Add a few messages and people, and AXON draws how they connect: the topics you talk about, what's waiting on you, and what helps with each person.",
      actions: [h("button", { type: "button", class: "btn primary", onclick: () => setView("inbox") }, "Go to Inbox")],
    })));
    return root;
  }

  root.append(controls(data));
  const panel = h("aside", { class: "graph-panel card stack tight", id: "graph-panel", "aria-live": "polite", "aria-label": "Details" });
  paintPanel(panel);

  if (g.mode === "list") {
    root.append(h("div", { class: "split map-split" }, listView(data, panel), panel));
  } else {
    syncLayout(data);
    g.view.mode = g.mode;
    root.append(h("div", { class: "split map-split" }, canvasBlock(data, panel), panel));
  }
  return root;
}

// ── controls ──
function controls(data) {
  const topicNodes = data.nodes.filter((n) => n.type === "topic");
  const configured = isConfigured(app.vault.provider);
  const filter = (key, label) => h("button", { type: "button", class: "chip-btn", "aria-pressed": String(g.filters[key]), onclick: () => { g.filters[key] = !g.filters[key]; g.fitted = false; emit(); } },
    h("span", { class: `dot ${key === "topics" ? "topic" : key === "commitments" ? "commit" : "support"}`, "aria-hidden": "true" }), label);
  const zoom = (f) => { g.view.zoom = Math.max(0.25, Math.min(5, g.view.zoom * f)); g.needsDraw = true; };
  return h("div", { class: "card flat stack tight", id: "map-controls" },
    h("div", { class: "row wrap" },
      h("span", { class: "label muted small", text: "Show" }),
      h("div", { class: "chips", role: "group", "aria-label": "What to show" }, filter("topics", "Topics"), filter("commitments", "Waiting on you"), filter("supports", "What helps"))),
    g.mode === "list" ? null : h("div", { class: "row wrap" },
      h("button", { type: "button", class: "btn sm icon-only", "aria-label": "Zoom out", onclick: () => zoom(1 / 1.25) }, icon("minus")),
      h("button", { type: "button", class: "btn sm icon-only", "aria-label": "Zoom in", onclick: () => zoom(1.25) }, icon("plus")),
      h("button", { type: "button", class: "btn sm", id: "map-reset", onclick: () => { g.view = { ...makeView(), mode: g.mode }; if (g.mode === "flat") g.view.yaw = 0; g.fitted = false; g.needsDraw = true; } }, icon("refresh"), "Reset view"),
      g.mode === "3d" && !reduceMotion() ? h("button", { type: "button", class: "btn sm", id: "map-spin", "aria-pressed": String(g.spin), onclick: (e) => { g.spin = !g.spin; e.currentTarget.setAttribute("aria-pressed", String(g.spin)); e.currentTarget.classList.toggle("on", g.spin); } }, "Gentle spin") : null,
      topicNodes.length ? h("button", { type: "button", class: "btn sm", id: "map-tidy", disabled: g.labelBusy || !configured, title: configured ? "" : "Connect an AI in Settings first", onclick: () => tidyNames(topicNodes) }, g.labelBusy ? spinner() : icon("sparkle"), "Tidy topic names with AI") : null),
    g.labelError ? h("div", { class: "err", role: "alert", text: g.labelError }) : null,
    topicNodes.length && configured && g.mode !== "list" ? h("p", { class: "hint", text: "Tidying names sends only the topic keywords to your AI, never your messages." }) : null);
}

async function tidyNames(topicNodes) {
  if (g.labelBusy) return;
  g.labelBusy = true; g.labelError = ""; emit();
  try {
    const labels = await labelTopics(app.vault, topicNodes);
    mutate((v) => { v.graph = v.graph ?? { labels: {} }; Object.assign(v.graph.labels, labels); }, { render: false });
    toast("Topic names updated.");
  } catch (e) {
    g.labelError = e?.message || "Couldn't tidy the names.";
  } finally {
    g.labelBusy = false;
    emit();
  }
}

// ── layout cache ──
function syncLayout(data) {
  const sig = data.nodes.map((n) => n.id).join("|") + "#" + data.links.map((l) => `${l.source}>${l.target}`).join(",");
  if (g.layout && g.sig === sig) return;
  const prev = g.layout?.snapshot();
  g.layout = createLayout(data, prev);
  g.layout.settle(prev ? 120 : 260); // settle instantly: calm, no wobbling on load
  g.sig = sig;
  g.fitted = false;
  g.needsDraw = true;
}

const posOf = (n) => g.layout.positions[g.layout.index.get(n.id)];

// ── canvas ──
function summary(data) {
  const c = (t) => data.nodes.filter((n) => n.type === t).length;
  return `Map of ${pluralize(c("person"), "person", "people")}, ${pluralize(c("topic"), "topic")}, ${pluralize(c("commitment"), "thing")} waiting on you and ${pluralize(c("support"), "support")}. Use the List view for a text version.`;
}

function canvasBlock(data, panel) {
  const canvas = h("canvas", { class: "graph-canvas", id: "graph-canvas", tabindex: "0", role: "img", "aria-label": summary(data), "aria-describedby": "graph-help" });
  const help = h("p", { id: "graph-help", class: "sr-only", text: "Arrow keys rotate the map. Plus and minus zoom. N and P move between items, Enter opens the selected item, Escape clears the selection. Or switch to List view." });
  const hint = h("p", { class: "hint graph-hint" }, g.mode === "3d" ? "Drag to rotate · scroll or pinch to zoom · tap a shape for details" : "Drag to move · scroll or pinch to zoom · tap a shape for details");
  attach(canvas, data, panel);
  return h("div", { class: "graph-col stack tight" }, h("div", { class: "graph-wrap" }, canvas, help), hint);
}

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const c = (n) => cs.getPropertyValue(n).trim() || "#888";
  return { work: c("--node-work"), personal: c("--node-personal"), topic: c("--node-topic"), commit: c("--node-commit"), support: c("--node-support"), text: c("--text"), muted: c("--muted"), surface: c("--surface"), accent: c("--accent") };
}
const colorOf = (n, pal) => (n.type === "person" ? (n.category === "work" ? pal.work : pal.personal) : n.type === "topic" ? pal.topic : n.type === "commitment" ? pal.commit : pal.support);

function shape(ctx, type, x, y, r) {
  ctx.beginPath();
  if (type === "person") ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (type === "topic") { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
  else if (type === "commitment") { const s = r * 1.7, k = r * 0.35; ctx.roundRect ? ctx.roundRect(x - s / 2, y - s / 2, s, s, k) : ctx.rect(x - s / 2, y - s / 2, s, s); }
  else { for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; const px = x + Math.cos(a) * r * 1.2, py = y + Math.sin(a) * r * 1.2; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
}

function projectAll(w, hgt) {
  return g.graph.nodes.map((n) => ({ n, s: project(posOf(n), g.view, w, hgt) }));
}

function draw(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!g.fitted) { Object.assign(g.view, fitView(g.layout.positions, g.view, cw, ch)); g.fitted = true; }

  const pal = palette();
  const pts = projectAll(cw, ch);
  const byId = new Map(pts.map((p) => [p.n.id, p]));
  const sel = g.selectedId;
  const near = sel ? new Set([sel, ...neighbours(g.graph, sel).map((x) => x.id)]) : null;
  const fade = (d) => (g.view.mode === "flat" ? 1 : Math.max(0.3, Math.min(1, 1 - (d + 220) / 900)));

  // links
  for (const l of g.graph.links) {
    const a = byId.get(l.source), b = byId.get(l.target);
    if (!a || !b) continue;
    const hot = sel && (l.source === sel || l.target === sel);
    ctx.globalAlpha = (sel ? (hot ? 0.75 : 0.07) : 0.34) * fade((a.s.depth + b.s.depth) / 2);
    ctx.strokeStyle = hot ? pal.accent : pal.muted;
    ctx.lineWidth = Math.min(3.2, 0.8 + (l.weight ?? 1) * 0.22) * Math.max(0.6, Math.min(1.4, (a.s.scale + b.s.scale) / 2));
    ctx.beginPath(); ctx.moveTo(a.s.x, a.s.y); ctx.lineTo(b.s.x, b.s.y); ctx.stroke();
  }

  // nodes, far to near
  pts.sort((p, q) => q.s.depth - p.s.depth);
  for (const { n, s } of pts) {
    const r = nodeRadius(n) * Math.max(0.55, Math.min(1.7, s.scale));
    const dim = sel && !near.has(n.id);
    ctx.globalAlpha = (dim ? 0.18 : 1) * fade(s.depth);
    ctx.fillStyle = colorOf(n, pal);
    shape(ctx, n.type, s.x, s.y, r);
    ctx.fill();
    if (n.id === sel || n.id === g.hoverId) { ctx.lineWidth = 3; ctx.strokeStyle = pal.text; ctx.globalAlpha = 1; ctx.stroke(); }
    n._sx = s.x; n._sy = s.y; n._sr = r; n._depth = s.depth; n._fade = fade(s.depth);
  }

  // labels (people always; others when relevant or zoomed in)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const { n, s } of [...pts].reverse()) {
    const relevant = n.type === "person" || n.id === sel || n.id === g.hoverId || (near && near.has(n.id)) || g.view.zoom > 1.45;
    if (!relevant) continue;
    if (sel && !near.has(n.id)) continue;
    const size = Math.round(Math.max(10, Math.min(15, 11.5 * Math.max(0.85, Math.min(1.25, s.scale)))));
    ctx.font = `${n.type === "person" ? 650 : 500} ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.globalAlpha = Math.max(0.55, fade(s.depth));
    const text = clip(n.label, 26);
    const y = s.y + n._sr + 4;
    ctx.lineWidth = 4; ctx.strokeStyle = pal.surface; ctx.lineJoin = "round"; ctx.strokeText(text, s.x, y);
    ctx.fillStyle = pal.text; ctx.fillText(text, s.x, y);
  }
  ctx.globalAlpha = 1;
}

function hit(canvas, x, y) {
  let best = null, bd = Infinity;
  for (const n of g.graph.nodes) {
    if (n._sx === undefined) continue;
    const d = Math.hypot(n._sx - x, n._sy - y);
    const reach = (n._sr ?? 8) * 1.3 + 9;
    if (d <= reach && (d < bd - 2 || (Math.abs(d - bd) <= 2 && n._depth < (best?._depth ?? Infinity)))) { best = n; bd = d; }
  }
  return best;
}

function select(id, panel) {
  g.selectedId = id;
  g.needsDraw = true;
  paintPanel(panel ?? document.getElementById("graph-panel"));
}

function attach(canvas, data, panel) {
  const pointers = new Map();
  let moved = 0, last = null, pinch = null;
  const rect = () => canvas.getBoundingClientRect();
  const local = (e) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    moved = 0; last = local(e);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: g.view.zoom }; }
    canvas.classList.add("grabbing");
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, p);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        g.view.zoom = Math.max(0.25, Math.min(5, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        moved = 99; g.needsDraw = true;
      } else if (pointers.size === 1 && last) {
        const dx = p.x - last.x, dy = p.y - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) {
          if (g.view.mode === "flat") { g.view.panX += dx; g.view.panY += dy; }
          else { g.view.yaw += dx * 0.0075; g.view.pitch = Math.max(-1.35, Math.min(1.35, g.view.pitch + dy * 0.0075)); }
          g.needsDraw = true;
        }
        last = p;
      }
    } else {
      const n = hit(canvas, p.x, p.y);
      const id = n?.id ?? null;
      if (id !== g.hoverId) { g.hoverId = id; canvas.classList.toggle("pointing", Boolean(id)); g.needsDraw = true; }
    }
  });
  const end = (e) => {
    const was = pointers.has(e.pointerId);
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) canvas.classList.remove("grabbing");
    if (was && moved <= 4 && e.type === "pointerup") { const n = hit(canvas, p.x, p.y); select(n?.id ?? null, panel); }
    last = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (g.hoverId) { g.hoverId = null; canvas.classList.remove("pointing"); g.needsDraw = true; } });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); g.view.zoom = Math.max(0.25, Math.min(5, g.view.zoom * Math.exp(-e.deltaY * 0.0016))); g.needsDraw = true; }, { passive: false });

  canvas.addEventListener("keydown", (e) => {
    const step = 0.12;
    const nodes = g.graph.nodes;
    const cycle = (dir) => { const i = nodes.findIndex((n) => n.id === g.selectedId); select(nodes[(i + dir + nodes.length) % nodes.length].id, panel); };
    if (e.key === "ArrowLeft") { if (g.view.mode === "flat") g.view.panX += 24; else g.view.yaw -= step; }
    else if (e.key === "ArrowRight") { if (g.view.mode === "flat") g.view.panX -= 24; else g.view.yaw += step; }
    else if (e.key === "ArrowUp") { if (g.view.mode === "flat") g.view.panY += 24; else g.view.pitch = Math.max(-1.35, g.view.pitch - step); }
    else if (e.key === "ArrowDown") { if (g.view.mode === "flat") g.view.panY -= 24; else g.view.pitch = Math.min(1.35, g.view.pitch + step); }
    else if (e.key === "+" || e.key === "=") g.view.zoom = Math.min(5, g.view.zoom * 1.15);
    else if (e.key === "-" || e.key === "_") g.view.zoom = Math.max(0.25, g.view.zoom / 1.15);
    else if (e.key === "n" || e.key === "N") return (e.preventDefault(), cycle(1));
    else if (e.key === "p" || e.key === "P") return (e.preventDefault(), cycle(-1));
    else if (e.key === "Enter") { const n = nodes.find((x) => x.id === g.selectedId); if (n) openNode(n); return; }
    else if (e.key === "Escape") return select(null, panel);
    else return;
    e.preventDefault();
    g.needsDraw = true;
  });

  // render loop: runs only while this canvas is on the page; draws only when something changed
  let raf = 0;
  const frame = () => {
    if (!canvas.isConnected) return; // view changed: stop quietly
    if (g.spin && g.mode === "3d" && !reduceMotion() && !pointers.size) { g.view.yaw += 0.0035; g.needsDraw = true; }
    if (g.needsDraw) { g.needsDraw = false; draw(canvas); }
    raf = requestAnimationFrame(frame);
  };
  new ResizeObserver(() => { g.needsDraw = true; }).observe(canvas);
  raf = requestAnimationFrame(frame);
  void raf;
  g.needsDraw = true;
}

// ── details panel ──
function openNode(n) {
  if (n.type === "person") setView("people", { selectedPersonId: n.personId });
  else if (n.type === "commitment") openMessage(n.messageId);
  else if (n.type === "topic") { app.searchDraft = n.meta.word; app.askMode = "search"; setView("ask"); }
}

function paintPanel(panel) {
  if (!panel) return;
  panel.replaceChildren();
  const sel = g.selectedId ? g.graph?.nodes.find((n) => n.id === g.selectedId) : null;
  if (!sel) {
    panel.append(
      h("h2", { text: "How to read the map" }),
      h("p", { class: "muted small", text: "Everything is drawn from your own messages and notes, on your device. Select a shape to see what it connects to." }),
      h("ul", { class: "legend", "aria-label": "Legend" },
        legendItem("person", "work", "Person (work)"), legendItem("person", "personal", "Person (personal)"),
        legendItem("topic", "", "Topic you keep coming back to"), legendItem("commitment", "", "Waiting on you"), legendItem("support", "", "What helps")));
    return;
  }
  const links = neighbours(g.graph, sel.id);
  panel.append(
    h("div", { class: "row wrap" }, chip(TYPE_NAME[sel.type], "accent"), sel.type === "person" ? chip(sel.category === "work" ? "Work" : "Personal") : null),
    h("h2", { text: sel.label }));

  if (sel.type === "person") {
    const p = personById(sel.personId);
    panel.append(h("p", { class: "muted small", text: [sel.meta.relationship, pluralize(sel.meta.messages, "message")].filter(Boolean).join(" · ") }));
    if (p?.supports?.length) panel.append(h("div", { class: "card-title" }, "What helps"), h("ul", {}, p.supports.map((s) => h("li", { text: s.text }))));
  } else if (sel.type === "topic") {
    panel.append(h("p", { class: "muted small", text: `Comes up in ${pluralize(sel.meta.messages, "message")}${sel.meta.related.length ? `, often with ${sel.meta.related.join(", ")}` : ""}.` }));
  } else if (sel.type === "commitment") {
    panel.append(h("p", { text: sel.meta.snippet }), h("div", { class: "row wrap" }, chip(sel.meta.due, "warn", "clock"), ...sel.meta.dates.map((d) => chip(d, "accent"))));
  } else if (sel.type === "support") {
    panel.append(h("p", { class: "muted small", text: `Helps with ${sel.meta.people.join(", ")}.` }));
  }

  if (links.length) {
    panel.append(h("div", { class: "card-title" }, `Connected to ${links.length}`),
      h("div", { class: "chips" }, links.slice(0, 24).map((n) => h("button", { type: "button", class: "chip-btn", onclick: () => select(n.id, panel) }, n.label))));
  }

  const actions = h("div", { class: "row wrap" });
  if (sel.type === "person") actions.append(h("button", { type: "button", class: "btn primary", onclick: () => openNode(sel) }, "Open person"));
  if (sel.type === "commitment") actions.append(h("button", { type: "button", class: "btn primary", onclick: () => openNode(sel) }, "Open the message"));
  if (sel.type === "topic") {
    actions.append(h("button", { type: "button", class: "btn primary", onclick: () => openNode(sel) }, icon("search"), "See the messages"),
      h("button", { type: "button", class: "btn", onclick: () => renameTopic(sel) }, icon("edit"), "Rename"));
  }
  actions.append(h("button", { type: "button", class: "btn ghost", onclick: () => select(null, panel) }, "Clear"));
  panel.append(actions);
}

function legendItem(type, kind, text) {
  return h("li", { class: "legend-item" }, h("span", { class: `swatch ${type} ${kind}`, "aria-hidden": "true" }), h("span", {}, text), h("span", { class: "sr-only", text: ` (${SHAPE_NAME[type]})` }));
}

function renameTopic(n) {
  const input = h("input", { class: "input", id: "topic-name", type: "text", maxlength: "30", value: n.label, autocomplete: "off" });
  openDialog({
    title: "Rename this topic",
    initialFocus: "#topic-name",
    body: h("div", { class: "stack" }, field({ label: "Name", id: "topic-name", control: input, hint: "Only changes the name on your map. Your messages stay as they are." })),
    actions: [
      { label: "Cancel", value: false },
      { label: "Save name", kind: "primary", onClick: () => {
        const name = input.value.trim();
        mutate((v) => { v.graph = v.graph ?? { labels: {} }; if (name) v.graph.labels[n.stem] = name; else delete v.graph.labels[n.stem]; });
        return true;
      } },
    ],
  });
}

// ── list view (also the screen-reader friendly version) ──
function listView(data, panel) {
  const col = h("div", { class: "list-col" });
  for (const type of ["person", "commitment", "topic", "support"]) {
    const items = data.nodes.filter((n) => n.type === type);
    if (!items.length) continue;
    const title = { person: "People", commitment: "Waiting on you", topic: "Topics", support: "What helps" }[type];
    col.append(h("div", { class: "group-label" }, h("span", { text: title }), h("span", { text: String(items.length) })),
      h("ul", { class: "list", "aria-label": title }, items.map((n) => {
        const ns = neighbours(data, n.id);
        return h("li", {}, h("button", { type: "button", class: "list-item", id: `node-${n.id.replace(/[^\w-]/g, "_")}`, "aria-current": String(g.selectedId === n.id), onclick: () => { select(n.id, panel); col.querySelectorAll(".list-item").forEach((b) => b.setAttribute("aria-current", String(b === document.activeElement))); } },
          h("span", { class: `swatch ${n.type} ${n.category ?? ""}`, "aria-hidden": "true" }),
          h("div", { class: "li-main" },
            h("div", { class: "li-name", text: n.label }),
            h("div", { class: "li-snippet", text: ns.length ? `Connected to ${ns.slice(0, 4).map((x) => x.label).join(", ")}${ns.length > 4 ? `, +${ns.length - 4} more` : ""}` : "No connections yet" }))));
      })));
  }
  return col;
}

export { fmtWhen, messageById };
