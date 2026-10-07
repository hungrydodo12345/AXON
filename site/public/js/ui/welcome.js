import { h, readFileText, fmtFull } from "../utils.js";
import { peekVault, openVault, passphraseStrength, VaultError } from "../vault.js";
import { app, createVault, startVault } from "../state.js";
import { icon, field, spinner, toast } from "./common.js";
import { openHelp } from "./help.js";

export function renderWelcome() {
  const root = h("main", { class: "welcome", id: "main" });

  root.append(
    h("div", { class: "welcome-top" },
      h("div", { class: "brand" }, h("div", { class: "brand-mark", "aria-hidden": "true", text: "A" }), h("span", { text: "AXON" })),
      h("button", { type: "button", class: "btn ghost", onclick: () => openHelp() }, icon("help"), "How it works")),
    h("header", { class: "hero" },
      h("h1", { text: "Messages, made manageable." }),
      h("p", { text: "AXON explains the tone of a message, offers calm ways to reply, and remembers the people in your life. All of it lives in one encrypted file that only you hold. There's no account and nothing stored on our servers." })),
    h("div", { class: "welcome-cards" }, newCard(), openCard()),
    h("div", { class: "promises" },
      promise("lock", "Encrypted on your device", "Your vault is locked with your passphrase before it's ever saved."),
      promise("shield", "Nothing kept on our servers", "No account, no database, no cookies, no tracking."),
      promise("sparkle", "You choose the AI", "Use any provider you like, run one on your own computer, or try it free.")));
  return root;
}

function promise(ic, title, text) {
  return h("div", { class: "promise" }, icon(ic), h("div", {}, h("strong", { text: title }), h("span", { text })));
}

// ── create ──
function newCard() {
  const name = h("input", { class: "input", id: "nv-name", type: "text", autocomplete: "off", maxlength: "60", placeholder: "e.g. Alex", "aria-describedby": "nv-name-hint" });
  const pass = h("input", { class: "input", id: "nv-pass", type: "password", autocomplete: "new-password", "aria-describedby": "nv-pass-hint" });
  const pass2 = h("input", { class: "input", id: "nv-pass2", type: "password", autocomplete: "new-password" });
  const meter = h("div", { class: "meter", "data-level": "", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const meterText = h("div", { class: "hint", id: "nv-pass-hint", text: "Tip: 3 or 4 random words, like “maple orbit quiet bicycle”." });
  const ack = h("input", { type: "checkbox", id: "nv-ack" });
  const error = h("div", { class: "err hidden", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn primary block" }, icon("lock"), "Create my vault");

  pass.addEventListener("input", () => {
    if (!pass.value) { meter.dataset.level = ""; meterText.textContent = "Tip: 3 or 4 random words, like “maple orbit quiet bicycle”."; return; }
    const s = passphraseStrength(pass.value);
    meter.dataset.level = String(s.level);
    meterText.textContent = s.label;
  });

  const form = h("form", { class: "stack", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.classList.add("hidden");
    const fail = (m) => { error.textContent = m; error.classList.remove("hidden"); };
    if (pass.value.length < 8) return fail("Please choose a passphrase of at least 8 characters.");
    if (pass.value !== pass2.value) return fail("The two passphrases don't match.");
    if (!ack.checked) return fail("Please tick the box to confirm you understand the passphrase can't be recovered.");
    btn.disabled = true;
    const prev = btn.textContent;
    btn.replaceChildren(spinner(), "Locking…");
    try {
      await createVault({ name: name.value.trim(), passphrase: pass.value });
    } catch (err) {
      fail("Something went wrong creating the vault: " + (err.message || err));
      btn.disabled = false;
      btn.replaceChildren(icon("lock"), prev);
    }
  } },
    h("h2", { text: "Start a new vault" }),
    h("p", { class: "muted", text: "First time here? Make your own private vault. It takes about 20 seconds." }),
    field({ label: "What should we call you?", id: "nv-name", control: name, hint: "Only used to personalise suggestions. Stays in your vault.", optional: true }),
    field({ label: "Choose a passphrase", id: "nv-pass", control: pass }),
    h("div", { class: "stack tight" }, meter, meterText),
    field({ label: "Type it again", id: "nv-pass2", control: pass2 }),
    h("label", { class: "check", for: "nv-ack" }, ack, h("span", { text: "I understand that nobody — including AXON — can recover this passphrase if I lose it." })),
    error,
    btn);
  return h("section", { class: "card", "aria-label": "Start a new vault" }, form);
}

// ── open ──
function openCard() {
  let fileText = null;
  let fileName = "";
  const picker = h("input", { type: "file", accept: ".axon,application/json,.json", class: "sr-only", id: "ov-file", tabindex: "-1" });
  const dropTitle = h("strong", { text: "Choose your vault file" });
  const dropSub = h("span", { class: "muted small", text: "or drag it here (.axon)" });
  const drop = h("button", { type: "button", class: "drop", id: "ov-drop", "aria-describedby": "ov-sub", onclick: () => picker.click() },
    icon("upload"), dropTitle, h("span", { id: "ov-sub" }, dropSub));
  const pass = h("input", { class: "input", id: "ov-pass", type: "password", autocomplete: "current-password" });
  const error = h("div", { class: "err hidden", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn primary block", disabled: true }, icon("lock"), "Unlock");
  const passField = field({ label: "Your passphrase", id: "ov-pass", control: pass });
  passField.classList.add("hidden");

  const showError = (m) => { error.textContent = m; error.classList.remove("hidden"); };

  async function takeFile(file) {
    error.classList.add("hidden");
    if (!file) return;
    try {
      if (file.size > 60 * 1024 * 1024) throw new VaultError("corrupt", "That file is too large to be an AXON vault.");
      const text = await readFileText(file);
      peekVault(text);
      fileText = text;
      fileName = file.name;
      drop.classList.add("has-file");
      dropTitle.textContent = file.name;
      dropSub.textContent = "Ready — enter your passphrase. Choose another file to change it.";
      passField.classList.remove("hidden");
      btn.disabled = false;
      pass.focus();
    } catch (e) {
      fileText = null;
      drop.classList.remove("has-file");
      dropTitle.textContent = "Choose your vault file";
      dropSub.textContent = "or drag it here (.axon)";
      passField.classList.add("hidden");
      btn.disabled = true;
      showError(e.message || "Couldn't read that file.");
    }
  }

  picker.addEventListener("change", () => takeFile(picker.files?.[0]));
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => takeFile(e.dataTransfer?.files?.[0]));

  const form = h("form", { class: "stack", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.classList.add("hidden");
    if (!fileText) return showError("Please choose your vault file first.");
    if (!pass.value) return showError("Please enter your passphrase.");
    btn.disabled = true;
    btn.replaceChildren(spinner(), "Unlocking…");
    try {
      const { vault, session } = await openVault(fileText, pass.value);
      startVault(vault, session, fileName);
      toast(`Vault opened — revision ${vault.revision}, saved ${fmtFull(vault.updatedAt)}.`);
    } catch (err) {
      showError(err.message || "Couldn't open that vault.");
      btn.disabled = false;
      btn.replaceChildren(icon("lock"), "Unlock");
      pass.select();
    }
  } },
    h("h2", { text: "Open my vault" }),
    h("p", { class: "muted", text: "Been here before? Bring your saved vault file. Open the one with the highest revision number (r12 beats r11)." }),
    picker, drop, passField, error, btn);
  return h("section", { class: "card", "aria-label": "Open my vault" }, form);
}
