import { h, fmtWhen } from "../utils.js";
import { app, setView, todoCount } from "../state.js";
import { icon, chip } from "./common.js";
import { installSlot } from "./install.js";
import { deviceEnabled } from "../state.js";
import { doSave, requestClose } from "./settings.js";
import { openHelp } from "./help.js";

const NAV = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "people", label: "People", icon: "users" },
  { id: "map", label: "Map", icon: "graph" },
  { id: "ask", label: "Ask", icon: "ask" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function chipContent() {
  const v = app.vault;
  const kids = [h("span", { class: "dot", "aria-hidden": "true" })];
  const onDevice = deviceEnabled();
  if (onDevice && app.device.status === "error") {
    kids.push(h("span", { text: "Couldn't keep on this device" }));
  } else if (onDevice && (app.device.status === "pending" || app.device.status === "saving")) {
    kids.push(h("span", { text: "Saving on this device…" }));
  } else if (app.dirty && onDevice && app.device.status === "ok") {
    kids.push(h("span", { text: "Kept on this device" }), h("span", { class: "chip-long", text: " · file not saved" }));
  } else if (app.dirty) {
    kids.push(h("span", { text: v.revision ? "Unsaved changes" : "Not saved yet" }));
  } else {
    kids.push(h("span", { text: `Revision ${v.revision}` }));
    if (app.savedAt) kids.push(h("span", { class: "chip-long", text: ` · saved ${fmtWhen(app.savedAt)}` }));
  }
  return kids;
}

/** Light update (no full re-render) used while typing in settings. */
export function paintStatus() {
  const chip = document.getElementById("vault-chip");
  if (!chip || !app.vault) return;
  chip.classList.toggle("dirty", app.dirty);
  chip.replaceChildren(...chipContent());
  const save = document.getElementById("save-btn");
  if (save) save.classList.toggle("attn", app.dirty);
  document.title = `${app.dirty ? "• " : ""}AXON`;
}

export function renderShell(viewNode, { onTour }) {
  const todo = todoCount();
  const topbar = h("header", { class: "topbar" },
    h("div", { class: "brand", "aria-label": "AXON" }, h("div", { class: "brand-mark", "aria-hidden": "true", text: "A" }), h("span", { class: "brand-text", text: "AXON" })),
    h("span", { class: "grow" }),
    app.pwa.online ? null : chip("Offline", "warn", "wifioff"),
    installSlot("hide-sm"),
    h("span", { class: `vault-chip ${app.dirty ? "dirty" : ""}`, id: "vault-chip", role: "status", "aria-live": "polite", title: app.fileName ? `File: ${app.fileName}` : "Your vault lives in this tab until you save it." }, chipContent()),
    h("button", { type: "button", class: `btn primary ${app.dirty ? "attn" : ""}`, id: "save-btn", onclick: doSave, "aria-label": "Save vault" }, icon("download"), h("span", { class: "hide-sm", text: "Save" })),
    h("button", { type: "button", class: "btn ghost icon-only", id: "help-btn", "aria-label": "Help and guide", onclick: () => openHelp({ onTour }) }, icon("help")),
    h("button", { type: "button", class: "btn ghost icon-only", id: "lock-btn", "aria-label": "Close vault", title: "Close vault", onclick: requestClose }, icon("lock")));

  const nav = h("nav", { class: "navrail", "aria-label": "Main" },
    NAV.map((n) => h("button", { type: "button", class: "nav-btn", id: `nav-${n.id}`, "aria-current": app.view === n.id ? "page" : null, onclick: () => setView(n.id) },
      icon(n.icon), h("span", { text: n.label }),
      n.id === "inbox" && todo ? h("span", { class: "count", "aria-label": `${todo} to do`, text: String(todo) }) : null)),
    h("div", { class: "nav-spacer" }),
    h("div", { class: "nav-foot" }, icon("shield"), h("span", { text: "Your data lives only in your vault file." })));

  return h("div", { class: "app" }, topbar, nav, h("main", { class: "main", id: "main", tabindex: "-1" }, viewNode));
}
