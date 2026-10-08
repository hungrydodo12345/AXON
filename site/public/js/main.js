/**
 * main.js — entry point. Renders the right screen for the current state and
 * keeps focus/scroll steady across re-renders.
 */

import { app, subscribe, subscribeLight, emit, deviceEnabled } from "./state.js";
import { initPwa } from "./pwa.js";
import { paintInstall } from "./ui/install.js";
import { checkTrial } from "./providers.js";
import { clear, h } from "./utils.js";
import { renderWelcome } from "./ui/welcome.js";
import { renderShell, paintStatus } from "./ui/shell.js";
import { renderInbox } from "./ui/inbox.js";
import { renderPeople } from "./ui/people.js";
import { renderAsk } from "./ui/ask.js";
import { renderMap } from "./ui/graph.js";
import { renderSettings } from "./ui/settings.js";
import { startTour } from "./ui/tour.js";

const root = document.getElementById("root");
const offeredTour = new Set();

const VIEWS = {
  inbox: renderInbox,
  people: renderPeople,
  map: renderMap,
  ask: renderAsk,
  settings: () => renderSettings({ onTour: startTour }),
};

function render() {
  // remember what had focus (by id) and where the page was scrolled
  const ae = document.activeElement;
  const keep = ae && root.contains(ae) && ae.id
    ? { id: ae.id, start: ae.selectionStart ?? null, end: ae.selectionEnd ?? null }
    : null;
  const scrollY = window.scrollY;

  clear(root);
  if (!app.vault) {
    root.append(renderWelcome());
    document.title = "AXON — messages, made manageable";
  } else {
    const view = (VIEWS[app.view] ?? renderInbox)();
    root.append(renderShell(view, { onTour: startTour }));
    document.title = `${app.dirty ? "• " : ""}AXON`;
  }

  window.scrollTo({ top: scrollY });
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el && !document.querySelector("dialog[open]") && !app.tourActive) {
      el.focus({ preventScroll: true });
      if (keep.start !== null && typeof el.setSelectionRange === "function") {
        try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
      }
    }
  }

  // first time in a fresh vault: offer the guided tour once
  if (app.vault && !app.vault.tour.done && !offeredTour.has(app.vault.id) && !app.tourActive) {
    offeredTour.add(app.vault.id);
    setTimeout(startTour, 350);
  }
}

subscribe(render);
subscribeLight(paintStatus);
subscribeLight(paintInstall);

window.addEventListener("beforeunload", (e) => {
  // no scary prompt if the latest changes are safely kept on this device
  if (app.vault && app.dirty && !(deviceEnabled() && app.device.status === "ok")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function unsupportedReason() {
  if (!window.isSecureContext || !globalThis.crypto?.subtle) return "AXON encrypts your vault with your browser's built-in security tools, which only work on a secure (https) connection. Please open this site using its https:// address.";
  if (typeof structuredClone !== "function" || typeof HTMLDialogElement === "undefined" || !CSS?.supports?.("color", "color-mix(in srgb, red, blue)")) return "This browser is a bit too old for AXON. Please update it, or try a current version of Chrome, Edge, Firefox or Safari.";
  return null;
}

const blocked = unsupportedReason();
if (blocked) {
  root.replaceChildren(h("main", { class: "welcome", id: "main" }, h("div", { class: "card stack", role: "alert" }, h("h1", { text: "AXON can't start here" }), h("p", { text: blocked }))));
} else {
  render();
  initPwa();
}
checkTrial().then((available) => {
  app.trial = { checked: true, available };
  if (app.vault) emit();
});

// debugging/test hook, only when the URL ends in #debug (exposes nothing beyond what's already in memory)
if (location.hash === "#debug") window.__axon = { app };
