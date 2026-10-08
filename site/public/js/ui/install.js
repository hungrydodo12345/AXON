/**
 * ui/install.js — the "Install app" button and its explanations.
 */

import { h } from "../utils.js";
import { app } from "../state.js";
import { promptInstall } from "../pwa.js";
import { icon, openDialog, toast } from "./common.js";

function iosHelp() {
  return openDialog({
    title: "Add AXON to your Home Screen",
    body: h("div", { class: "stack" },
      h("ol", {},
        h("li", { text: "Tap the Share button at the bottom (or top) of Safari." }),
        h("li", { text: "Scroll down and tap “Add to Home Screen”." }),
        h("li", { text: "Tap “Add”. AXON now opens like an app, even without internet." })),
      h("p", { class: "muted", text: "Your vault file still lives wherever you saved it. Install only adds the app itself." })),
    actions: [{ label: "Got it", kind: "primary", value: true }],
  });
}

/** A button for the top bar / welcome screen. Returns null when there's nothing to offer. */
export function installButton({ small = false, className = "" } = {}) {
  const { installed, canPrompt, ios } = app.pwa;
  if (installed) return null;
  if (!canPrompt && !ios) return null;
  return h("button", {
    type: "button", id: "install-btn", class: `btn ${small ? "sm" : ""} ${className}`.trim(),
    onclick: async () => {
      if (canPrompt) {
        const outcome = await promptInstall();
        if (outcome === "dismissed") toast("No problem. You can install any time from Settings.");
      } else iosHelp();
    },
  }, icon("download"), "Install app");
}

/** Refresh just the install button(s) in place — never re-renders the page, so nothing someone is typing is lost. */
export function paintInstall() {
  for (const slot of document.querySelectorAll("[data-install-slot]")) {
    const btn = installButton({ small: true, className: slot.dataset.cls || "" });
    slot.replaceChildren(...(btn ? [btn] : []));
  }
}

/** A wrapper the top bar / welcome screen can place; paintInstall() keeps it current. */
export function installSlot(className = "") {
  const btn = installButton({ small: true, className });
  return h("span", { dataset: { installSlot: "", cls: className } }, btn);
}

/** The longer explanation shown in Settings → Offline. */
export function installStatus() {
  const { installed, canPrompt, ios, offlineReady } = app.pwa;
  if (installed) return h("div", { class: "note ok", text: "AXON is installed on this device." });
  if (canPrompt || ios) return h("div", { class: "row wrap" }, installButton(), h("span", { class: "hint", text: ios && !canPrompt ? "Shows how to add AXON to your Home Screen." : "Adds AXON to your app list and opens it in its own window." }));
  return h("p", { class: "hint", text: offlineReady
    ? "This browser doesn't offer an install button, but AXON still works offline. You can also look for “Install app” or “Add to Home Screen” in the browser menu."
    : "Install isn't available here (it needs https and a supporting browser such as Chrome, Edge or Safari)." });
}
