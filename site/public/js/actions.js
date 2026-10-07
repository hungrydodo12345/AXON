/**
 * actions.js — async operations shared by several views.
 */

import { app, mutate, emit, messageById, personById, setView } from "./state.js";
import { isConfigured } from "./providers.js";
import { analyzeMessage, summarizePerson } from "./analyze.js";
import { toast } from "./ui/common.js";

const controllers = new Map();

export function cancelBusy(key) {
  controllers.get(key)?.abort();
}

export async function runAnalysis(messageId) {
  const vault = app.vault;
  const msg = messageById(messageId);
  if (!vault || !msg || app.busy.has(messageId)) return;
  if (!isConfigured(vault.provider)) {
    toast("Connect an AI first — Settings → AI connection.", { kind: "error" });
    setView("settings");
    return;
  }
  const ctl = new AbortController();
  controllers.set(messageId, ctl);
  app.busy.add(messageId);
  delete app.errors[messageId];
  emit();
  try {
    const analysis = await analyzeMessage(vault, msg, personById(msg.personId), { signal: ctl.signal });
    if (app.vault?.id !== vault.id) return;
    mutate((v) => {
      const m = v.messages.find((x) => x.id === messageId);
      if (!m) return;
      m.analysis = analysis;
      m.needsReply = analysis.needs_reply;
    }, { render: false });
  } catch (e) {
    if (e?.code !== "aborted") app.errors[messageId] = e?.message || "Something went wrong.";
  } finally {
    controllers.delete(messageId);
    app.busy.delete(messageId);
    if (app.vault) emit();
  }
}

export async function runSummary(personId) {
  const vault = app.vault;
  const person = personById(personId);
  const key = `summary:${personId}`;
  if (!vault || !person || app.busy.has(key)) return;
  if (!isConfigured(vault.provider)) {
    toast("Connect an AI first — Settings → AI connection.", { kind: "error" });
    setView("settings");
    return;
  }
  const ctl = new AbortController();
  controllers.set(key, ctl);
  app.busy.add(key);
  delete app.errors[key];
  emit();
  try {
    const summary = await summarizePerson(vault, person, { signal: ctl.signal });
    if (app.vault?.id !== vault.id) return;
    mutate((v) => { v.summaries[personId] = summary; }, { render: false });
  } catch (e) {
    if (e?.code !== "aborted") app.errors[key] = e?.message || "Something went wrong.";
  } finally {
    controllers.delete(key);
    app.busy.delete(key);
    if (app.vault) emit();
  }
}
