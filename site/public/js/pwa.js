/**
 * pwa.js — install button, offline awareness and the service worker.
 *
 * The service worker caches only AXON's own code (the "app shell") so the app
 * opens offline. It never sees, caches or stores any vault data, message text
 * or AI traffic.
 */

import { app, emit, paintLight } from "./state.js";

// With a vault open a re-render is safe (focus and scroll are preserved). On the welcome screen it would wipe
// whatever someone is typing (their passphrase!), so we only repaint the small bits that changed.
const refresh = () => (app.vault ? emit() : paintLight());
import { checkTrial } from "./providers.js";
import { toast } from "./ui/common.js";

let deferred = null;

const isStandalone = () =>
  (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || globalThis.navigator?.standalone === true;

function detectIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function initPwa() {
  app.pwa.installed = isStandalone();
  app.pwa.ios = detectIos();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-infobar
    deferred = e;
    app.pwa.canPrompt = true;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    app.pwa.canPrompt = false;
    app.pwa.installed = true;
    toast("AXON is installed. Open it from your home screen or app list.");
    refresh();
  });
  const setOnline = () => {
    app.pwa.online = navigator.onLine !== false;
    if (app.pwa.online && !app.trial.available) checkTrial().then((ok) => { if (ok) { app.trial = { checked: true, available: true }; if (app.vault) emit(); } });
    refresh();
  };
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOnline);
  matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => { app.pwa.installed = isStandalone(); refresh(); });

  registerServiceWorker();
}

export async function promptInstall() {
  if (!deferred) return "unavailable";
  deferred.prompt();
  let outcome = "dismissed";
  try { outcome = (await deferred.userChoice).outcome; } catch { /* ignore */ }
  deferred = null;
  app.pwa.canPrompt = false;
  refresh();
  return outcome;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    await navigator.serviceWorker.register("./sw.js");
    const reg = await navigator.serviceWorker.ready; // resolves once the shell is fully cached and active
    app.pwa.offlineReady = Boolean(reg.active);
    refresh();
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) toast("AXON was updated. Reload the page to use the new version.");
    });
  } catch {
    app.pwa.offlineReady = false; // offline use simply isn't available; everything else works
  }
}
