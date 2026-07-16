# AXON

A local-first personal cognitive layer — it remembers relationships, not just messages. Currently implemented as a WhatsApp bridge + local desktop app (Next.js UI wrapped in Electron), with everything stored on your machine.

---

## What's actually running here

```
librarian.js        → Express bridge: WhatsApp listener, REST API, SSE stream
localStore.js        → Local JSON-file datastore (replaces Firebase entirely)
localSchema.js        → Schema + helpers on top of localStore.js
app/                  → Next.js UI (onboarding + inbox)
components/          → Inbox UI components (piles, message cards, sensory panel, panic button)
electron/            → Desktop shell that wraps the bridge + UI in a native window
```

No Firebase, no external account, no cloud database. Your profile, messages, embeddings, and settings live in a single JSON file under `data/` on your machine (see `AXON_DATA_DIR` below).

---

## Run it today — one double-click, no terminal required

- **Windows**: double-click `scripts/Launch-AXON.bat`
- **macOS**: double-click `scripts/Launch-AXON.command` (or see the AppleScript note below)

Either one: checks for Node.js (tells you where to get it if missing), runs `npm install` on first launch, auto-generates a local `.env` with a random `AUTH_SECRET` if none exists, then opens the real desktop app. Nothing to configure — it uses AXON's built-in trial AI key by default (see **Trial key** below), so it works immediately with zero setup.

### macOS: getting an actual `.scpt`/`.app`

`scripts/Launch-AXON.applescript` is AppleScript **source** — macOS needs it compiled to be double-clickable, which requires Script Editor (can't be done from this Linux dev environment). One-time step on your Mac: open the file in Script Editor → File → Export... → File Format: "Application" → Save (into `scripts/`). After that, double-click the exported file like any other app. It just opens Terminal and runs `Launch-AXON.command` under the hood, so `.command` is the one doing the real work either way.

### Manual / terminal path

```bash
npm install
cp .env.example .env      # or run: npm run setup:key
npm run electron:dev
```

Prefer a browser instead of the desktop shell? Run the two dev servers directly:

```bash
npm run dev        # bridge on :3000
npm run next:dev   # UI on :3001
```

---

## Getting your own Groq or Gemini API key

You don't need to do this to try AXON (see **Trial key**), but if you want your own:

```bash
npm run setup:key
```

This opens the right signup/key page in your browser (Groq or Gemini, your choice), waits for you to paste the key, and writes it into `.env` for you — no manual editing, no hunting for the right field name.

`config.js` now resolves either provider (`getGroqConfig` / `getGeminiConfig` / `getActiveProvider`). Note: Gemini support currently covers key acquisition + config resolution only — the actual inference pipeline (`triage.js`, `translator.js`, `sarcasmEngine.js`, `responseGenerator.js`, `vectorStore.js`) still calls the Groq SDK directly. Swapping those to route through `getActiveProvider()` so Gemini keys actually get used for inference is tracked in `TODO.md`.

---

## Building a signed installer (optional, later)

```bash
npm run dist:mac    # produces a .dmg — must be run on a real Mac
npm run dist:win    # produces an .exe (nsis installer)
```

Both use `electron-builder` (see the `build` block in `package.json`). The **macOS build must run on an actual Mac** — Apple doesn't allow cross-signing a `.dmg` from Linux/Windows. The **Windows build can be produced from any OS** via `electron-builder`'s bundled Wine, but hasn't been verified end-to-end outside this repo's dev sandbox (the sandbox this was built in has no outbound access to download Electron's platform binaries, so the actual `.exe`/`.dmg` build has not been run to completion here — only the config and the underlying dev app have been verified). For now, the launcher scripts above are the recommended way to distribute this.

Neither installer is code-signed. Unsigned builds will trigger a Gatekeeper/SmartScreen warning on first launch — expected until you have a signing certificate.

---

## Trial key (zero-setup first run / demo)

`config.js` resolves the Groq key in this order: **user-provided key → `GROQ_API_KEY` env var → hardcoded `TRIAL_KEYS.GROQ_API_KEY`**. That hardcoded fallback is currently a live Groq key (set at the user's explicit request, for demo purposes) — anyone running this code gets working AI out of the box with zero setup. Swap it for your own key (or blank it out) before any real/production distribution; it's a demo convenience, not a secret-management strategy.

---

## What's NOT done yet

Being upfront about the gap between "runs today" and "a real product":

- **Standalone Android app** (on-device vector DB + offline AI) — not started. This is a substantial separate build, not a packaging variant of the desktop app.
- **iOS / Android companion apps** — not started (dropped from this session's scope to focus on Mac/Windows).
- **Google Sign-In / cross-device encrypted sync** — not started. `TRIAL_KEYS`/BYOK exists for AI providers only; there's no account system or sync protocol yet.
- **Code signing & notarization** for the Mac/Windows installers — not set up; builds will show OS security warnings.
- **App icons** — `manifest.json`/`layout.jsx` reference `/icons/icon-192.png` etc. that don't exist yet; add real icon files under `public/icons/`.
- **whatsapp-web.js + Puppeteer bundle size** — packaging Chromium (via Puppeteer) inside an Electron app (which already ships its own Chromium) will produce a large installer. Worth revisiting — e.g. pointing Puppeteer at Electron's own Chromium — before wide distribution.
- The original relationship-memory/multi-connector vision from the AXON PRD (Gmail/Slack connectors, semantic search across platforms, reminder engine) is a different, larger scope than this WhatsApp-bridge codebase currently covers — see `TODO.md`. The prioritized connector list is: native (Gmail, Outlook/Microsoft 365, Slack, Discord) + manual import (WhatsApp chat export, iMessage macOS export) — deliberately skipping the platforms that fight you on API access.
- **Gemini inference wiring** — key acquisition works (`npm run setup:key`), but `triage.js`/`translator.js`/`sarcasmEngine.js`/`responseGenerator.js`/`vectorStore.js` still call the Groq SDK directly rather than routing through `config.js`'s `getActiveProvider()`.

---

## Security note

Rotate any credentials that were ever committed to this repo's git history before relying on it — check `TODO.md` / recent commit messages for details if you're picking this up fresh.

---

## Original security checklist (still applies)

- [ ] `.env` is in `.gitignore` and never committed
- [ ] `AUTH_SECRET` is at least 32 random characters
- [ ] `ALLOWED_ORIGINS` is set to your exact origin(s)
- [ ] `data/` (local datastore) is never committed — it's gitignored, but double-check before pushing
