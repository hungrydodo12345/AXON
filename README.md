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

## Run it today (fastest path — no packaging needed)

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
GROQ_API_KEY=gsk_...          # free at console.groq.com
AUTH_SECRET=<32+ random chars>
ALLOWED_ORIGINS=http://localhost:3001
```

No Groq key yet? Leave `GROQ_API_KEY` unset and set `AXON_TRIAL_GROQ_API_KEY` instead (see **Trial key** below) — the app falls back to it automatically so there's zero setup for a first run.

Then open the real desktop app:

```bash
npm run electron:dev
```

This spawns the bridge and the Next.js UI as child processes and opens a native window pointed at them — nothing to configure, no browser tab to find. First run walks you through onboarding (phone number, preferences, safety word, optional API key), then drops you into the inbox.

Prefer a browser instead of the desktop shell? Run the two dev servers directly:

```bash
npm run dev        # bridge on :3000
npm run next:dev   # UI on :3001
```

---

## Building an installer

```bash
npm run dist:mac    # produces a .dmg — must be run on a real Mac
npm run dist:win    # produces an .exe (nsis installer)
```

Both use `electron-builder` (see the `build` block in `package.json`). The **macOS build must run on an actual Mac** — Apple doesn't allow cross-signing a `.dmg` from Linux/Windows. The **Windows build can be produced from any OS** via `electron-builder`'s bundled Wine, but hasn't been verified end-to-end outside this repo's dev sandbox (the sandbox this was built in has no outbound access to download Electron's platform binaries, so the actual `.exe`/`.dmg` build has not been run to completion here — only the config and the underlying dev app have been verified).

Neither installer is code-signed. Unsigned builds will trigger a Gatekeeper/SmartScreen warning on first launch — expected until you have a signing certificate.

---

## Trial key (zero-setup first run)

`config.js` resolves the Groq key in this order: **user-provided key → `GROQ_API_KEY` env var → `AXON_TRIAL_GROQ_API_KEY`**. Set the trial env var (or paste the key directly into the `TRIAL_KEYS.GROQ_API_KEY` fallback in `config.js`) if you want people to be able to download and run AXON with literally no setup. Swap it for your own key before any real distribution — it's meant for a trial, not production traffic.

---

## What's NOT done yet

Being upfront about the gap between "runs today" and "a real product":

- **Standalone Android app** (on-device vector DB + offline AI) — not started. This is a substantial separate build, not a packaging variant of the desktop app.
- **iOS / Android companion apps** — not started (dropped from this session's scope to focus on Mac/Windows).
- **Google Sign-In / cross-device encrypted sync** — not started. `TRIAL_KEYS`/BYOK exists for AI providers only; there's no account system or sync protocol yet.
- **Code signing & notarization** for the Mac/Windows installers — not set up; builds will show OS security warnings.
- **App icons** — `manifest.json`/`layout.jsx` reference `/icons/icon-192.png` etc. that don't exist yet; add real icon files under `public/icons/`.
- **whatsapp-web.js + Puppeteer bundle size** — packaging Chromium (via Puppeteer) inside an Electron app (which already ships its own Chromium) will produce a large installer. Worth revisiting — e.g. pointing Puppeteer at Electron's own Chromium — before wide distribution.
- The original relationship-memory/multi-connector vision from the AXON PRD (Gmail/Slack connectors, semantic search across platforms, reminder engine) is a different, larger scope than this WhatsApp-bridge codebase currently covers — see `TODO.md`.

---

## Security note

Rotate any credentials that were ever committed to this repo's git history before relying on it — check `TODO.md` / recent commit messages for details if you're picking this up fresh.

---

## Original security checklist (still applies)

- [ ] `.env` is in `.gitignore` and never committed
- [ ] `AUTH_SECRET` is at least 32 random characters
- [ ] `ALLOWED_ORIGINS` is set to your exact origin(s)
- [ ] `data/` (local datastore) is never committed — it's gitignored, but double-check before pushing
