# AXON

A local-first personal cognitive layer — it remembers relationships, not just messages. Local desktop app (Next.js UI wrapped in Electron) with everything stored on your machine.

---

## What's actually running here

```
librarian.js          → Express bridge: connector pipeline, REST API, SSE stream
connectors/emailImap.js     → Live email connector (IMAP — Gmail, Outlook/365, etc.)
connectors/gmailApi.js      → Live Gmail connector (Gmail API, OAuth)
connectors/googleCalendar.js → Google Calendar read access
connectors/whatsappImport.js → WhatsApp chat-export parser (manual import)
localStore.js          → Local JSON-file datastore (replaces Firebase entirely)
localSchema.js          → Schema + helpers on top of localStore.js (profiles, messages, contacts)
app/                    → Next.js UI (onboarding + inbox)
components/            → Inbox UI (piles, message cards, sensory panel, panic button, import panel, people panel)
electron/              → Desktop shell that wraps the bridge + UI in a native window
```

No Firebase, no external account, no cloud database. Your profile, messages, embeddings, contacts, and settings live in a single JSON file under `data/` on your machine.

**Message sources today:**
- **Email** — live via generic IMAP (optional, set `EMAIL_IMAP_*` in `.env`), live via the real Gmail API (`npm run connect:google` — see tutorial below), or manual paste (Import → Email in the app, works with zero setup)
- **Calendar** — read-only, via `npm run connect:google` (same OAuth as Gmail) — `GET /api/calendar/:userId`
- **WhatsApp** — manual import only. WhatsApp has no personal-account API; a live bridge (`whatsapp-web.js`, driving WhatsApp Web via headless Chromium + QR login) was tried and removed — see **Why WhatsApp is manual-import-only** below. Export a chat from WhatsApp ("Export Chat" → without media) and import the .txt via Import → WhatsApp export in the app.
- Outlook/Slack/Discord native connectors: not built yet — see `TODO.md`.

**People** — every sender AXON sees a message from is auto-added to People (header → People), grouped into **Work** and **Personal** sections (defaults to Personal until you say otherwise), with just their raw address/id as a name. Click them to add a real name, how you know them ("sister," "coworker," "college friend" — freeform), and notes. Once set, that name shows up on all their future messages and is never overwritten by the auto-add logic. You can also add someone manually — pick Work or Personal up front — before they've ever messaged you.

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

## Gmail & Calendar API setup (optional — not required)

This is entirely optional. Email and WhatsApp already work with zero setup via manual import, and email also works live via generic IMAP with just an app password (see above) — neither needs anything below. This section is only for the extra step up to the *real* Gmail/Calendar API via OAuth, which involves Google's app-verification flow (see the troubleshooting note on "unverified app" below) and isn't necessary for AXON to be useful.

This connects AXON to your real Gmail inbox and Google Calendar via OAuth (the same "sign in with Google, approve access" flow every Google-connected app uses — nothing custom or unusual). Takes about 5 minutes. You only need to do steps 1–5 once, ever.

**1. Create a Google Cloud project**
Go to [console.cloud.google.com](https://console.cloud.google.com) → click the project dropdown (top left) → **New Project** → name it anything (e.g. "AXON") → Create.

**2. Enable the two APIs**
With your new project selected, go to **APIs & Services → Library**, and enable both:
- **Gmail API**
- **Google Calendar API**
(Search for each by name, click it, click **Enable**.)

**3. Configure the OAuth consent screen**
Go to **APIs & Services → OAuth consent screen**.
- User type: **External** (unless you have a Google Workspace org — then Internal works too)
- Fill in the required fields (app name, your email) — nothing else matters for personal use
- On the **Scopes** step, you can skip adding scopes here (the app requests them directly)
- On the **Test users** step, **add your own Gmail address** — this is required while the app is in "Testing" mode, which is fine for personal use and avoids Google's app-review process entirely
- Save through to the end

**4. Create an OAuth Client ID**
Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
- Application type: **Desktop app** (important — this is what lets the sign-in flow work on `localhost` without extra config)
- Name it anything
- Click **Create** — you'll get a **Client ID** and **Client Secret**. Copy both (you can also come back to Credentials later to see them again).

**5. Connect it to AXON**
```bash
npm run connect:google
```
Paste in the Client ID and Client Secret from step 4, then the phone number/id you used when you set up your AXON profile. It opens your browser to Google's real sign-in/consent screen — sign in, approve access, and you're done. It writes everything to `.env` for you.

**6. Restart AXON**
Next launch, `/health` will show `"gmail_connector":"connected"`, Gmail will start polling for unread mail (every 2 minutes by default — `GOOGLE_GMAIL_POLL_MS` in `.env`), and `GET /api/calendar/:userId` will return your upcoming events.

**If something goes wrong:**
- *"redirect_uri_mismatch"* — double check the OAuth client is type **Desktop app**, not "Web application."
- *No refresh token returned* — Google only issues one the first time you approve an app, or after you've revoked it. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions), remove AXON, and run `npm run connect:google` again.
- *"Access blocked: AXON has not completed Google verification"* — make sure you added yourself as a **Test user** in step 3; testing-mode apps skip verification entirely for test users.

Not built yet: a Calendar UI panel (the API works — `GET /api/calendar/:userId` — but there's no inbox widget showing events yet, tracked in `TODO.md`), and the generic IMAP email connector still runs independently of this — you can use either or both.

---

## Building a signed installer (optional, later)

```bash
npm run dist:mac    # produces a .dmg — must be run on a real Mac
npm run dist:win    # produces an .exe (nsis installer)
```

Both use `electron-builder` (see the `build` block in `package.json`). The **macOS build must run on an actual Mac** — Apple doesn't allow cross-signing a `.dmg` from Linux/Windows. The **Windows build can be produced from any OS** via `electron-builder`'s bundled Wine, but hasn't been verified end-to-end outside this repo's dev sandbox (the sandbox this was built in has no outbound access to download Electron's platform binaries, so the actual `.exe`/`.dmg` build has not been run to completion here — only the config and the underlying dev app have been verified). For now, the launcher scripts above are the recommended way to distribute this.

Neither installer is code-signed. Unsigned builds will trigger a Gatekeeper/SmartScreen warning on first launch — expected until you have a signing certificate.

---

## Why WhatsApp is manual-import-only

There's no public API for personal WhatsApp accounts. The only way to get live messages is `whatsapp-web.js`, which puppets WhatsApp Web through a headless Chromium browser and requires scanning a QR code. In this codebase that meant:

- **Puppeteer's Chromium isn't bundled** — it downloads on first run (large, and the QR code needed to authorize it printed to a terminal window, a bad experience for anyone not comfortable with a terminal).
- **It was already broken in this sandbox** — `whatsapp.initialize()` failed outright (`Could not find Chrome`) every time it was tested here, and was only kept from crashing the whole app by a `.catch()` added defensively.
- **It duplicates your own connector plan** — your own connector list already scopes WhatsApp as "Manual Imports: chat export," not a live integration.

Given all three, the live bridge was removed rather than patched. `connectors/whatsappImport.js` now parses a real WhatsApp chat-export .txt (both iOS `[bracket]` and Android `dash -` formats, multi-line messages, system-message filtering) and feeds it through the exact same pipeline as everything else. If a live WhatsApp connection becomes a hard requirement later, re-adding `whatsapp-web.js` is straightforward — the pipeline it needs to call into (`processIncomingMessage` in `librarian.js`) is now a stable, general entrypoint rather than WhatsApp-specific code.

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
- **Outlook/Slack/Discord native connectors** — not built (Gmail and generic-IMAP email both work; those three need their own OAuth/bot-token integrations, tracked in `TODO.md`).
- **Calendar UI** — the API works (`GET /api/calendar/:userId`) but there's no inbox widget/panel showing events yet.
- **Gmail/Calendar connector code is syntax-verified but not tested against a real Google account** — no Google Cloud project or test credentials available in this dev sandbox. The manual email/WhatsApp import paths remain the ones verified fully end-to-end.
- **iMessage import** — not built (no live connector possible either; Apple has no API for it).
- The original relationship-memory/multi-connector vision from the AXON PRD (semantic search across platforms, reminder engine, relationship timeline) is a different, larger scope than this codebase currently covers — see `TODO.md`.
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
