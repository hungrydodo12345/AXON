# AXON — To-Do List

Engineering backlog derived from the AXON PRD (v0.1), scoped against what this repo (formerly "Neuro-Librarian") actually contains today. See `README.md` for how to run what's already working.

## Done this session

- [x] Removed Firebase entirely — replaced with a local JSON-file datastore (`localStore.js` + `localSchema.js`) mirroring the same collection/doc API, so all data stays on-device.
- [x] Rewired every module off Firestore (`librarian.js`, `vectorStore.js`, `memoryEngine.js`, `gargoyle.js`, `growthTracker.js`, `wuphf.js`) and off the client Firebase SDK (`app/onboarding/page.jsx` now posts to `POST /api/profile`).
- [x] Added a hardcoded-trial-key fallback slot for Groq (`config.js` → `TRIAL_KEYS`) for zero-setup first runs.
- [x] Restructured the flat, non-functional file layout into a real Next.js App Router app (`app/`, `components/`, `styles/`, `public/`) — the project had no working page routing before this.
- [x] Fixed a build-breaking bug: `middleware.js` collided with Next.js's reserved Middleware convention and was being bundled into the Edge runtime; renamed to `bridgeSecurity.js`.
- [x] Added `app/page.jsx` (inbox) with a new `GET /api/state/:userId` endpoint to hydrate it, plus SSE-over-query-token auth support.
- [x] Made WhatsApp connection failures non-fatal so the rest of the app (UI, API, local memory) still boots without a live WhatsApp session.
- [x] Added Electron desktop shell (`electron/main.js`, `electron/preload.js`) and `electron-builder` packaging config for macOS (`.dmg`) and Windows (`.exe`/nsis).
- [x] Verified end-to-end in this session: `next build` succeeds; the bridge boots; profile creation → auth token → inbox hydrate round-trip correctly through the local datastore.
- [x] Renamed the product from "Neuro-Librarian" to "AXON" across `package.json`, UI copy, boot banners, and manifest.

## Done this session (round 2)

- [x] Launcher scripts instead of installers: `scripts/Launch-AXON.bat` (Windows) and `scripts/Launch-AXON.command` (macOS, double-click) — both auto-install deps, auto-generate `.env`/`AUTH_SECRET` on first run, then launch the desktop app. No terminal needed.
- [x] `scripts/Launch-AXON.applescript` — AppleScript source for a literal `.scpt`/`.app`; needs a one-time compile via Script Editor on an actual Mac (documented in README), since that step needs macOS tooling this dev sandbox doesn't have.
- [x] `scripts/setup-api-key.js` (`npm run setup:key`) — interactive pipeline that opens the Groq or Gemini key page in the browser, waits for the pasted key, writes it into `.env`.
- [x] Added Gemini as a second provider at the config layer (`getGeminiConfig`, `getActiveProvider`) — key acquisition + resolution only, not yet wired into inference (see below).
- [x] Hardcoded a live Groq key as the trial fallback in `config.js` (`TRIAL_KEYS.GROQ_API_KEY`) at the user's explicit request, so the demo works with zero setup.

## Done this session (round 3)

- [x] **Removed the live WhatsApp bridge entirely** (`whatsapp-web.js`, `qrcode-terminal`, and 93 transitive packages including bundled Puppeteer). It was untested-working in this sandbox (`Could not find Chrome`, only kept from crashing the app by a defensive `.catch()`), required a QR-code-in-terminal login flow that's a bad fit for a double-click-launched app, and duplicated the user's own stated plan to treat WhatsApp as manual-import-only. See README "Why WhatsApp is manual-import-only" for the full reasoning.
- [x] Refactored `librarian.js`'s WhatsApp-specific `processMessage()` into a generic `processIncomingMessage()` shared by every connector — this is now the one real entrypoint into triage/translation/memory/storage, independent of source platform.
- [x] `connectors/whatsappImport.js` — parses real WhatsApp chat-export .txt (iOS `[bracket]` format, Android `dash -` format, multi-line messages, system-message filtering). Verified against sample exports of both formats.
- [x] `connectors/emailImap.js` — live email via IMAP (Gmail/Outlook/365/Yahoo/iCloud, any provider, via app password — no OAuth app registration needed). Optional: no-ops cleanly if `EMAIL_IMAP_*` env vars aren't set; never crashes the app on connection failure.
- [x] `POST /api/import/email/:userId` and `POST /api/import/whatsapp/:userId` — manual import endpoints, both auth-protected, both verified end-to-end via curl (profile → token → import → inbox hydrate all round-tripped correctly).
- [x] `components/ImportPanel.jsx` — in-app UI (Import button in the inbox header) with two tabs: paste-an-email and paste-or-upload-a-WhatsApp-export.

## Known gaps (see README "What's NOT done yet")

- [ ] Actual `.dmg`/`.exe` build has not been produced end-to-end (this dev sandbox has no network access to download Electron's platform binaries) — config is written and the underlying app is verified working, but `npm run dist:mac` / `dist:win` need to be run for real on a Mac / Windows machine (or CI) before distributing. Launcher scripts are the recommended path for now.
- [ ] Code signing & notarization for both installers.
- [ ] Real app icons (referenced but missing under `public/icons/`).
- [ ] Gemini inference wiring — `triage.js`, `translator.js`, `sarcasmEngine.js`, `responseGenerator.js`, `vectorStore.js` still call the Groq SDK directly instead of `config.js`'s `getActiveProvider()`.
- [ ] `Launch-AXON.bat` is written but untested on an actual Windows machine (no Windows available in this dev sandbox) — the underlying `.env`/`AUTH_SECRET` generation logic was verified in isolation with equivalent shell logic, but not the batch file itself end-to-end.
- [ ] `connectors/emailImap.js` is syntax-verified but not tested against a real IMAP server (no live mailbox credentials available in this dev sandbox) — the manual email import path (`POST /api/import/email`) is the one that's been fully verified end-to-end.
- [ ] **Security**: rotate the Firebase service account key and `AUTH_SECRET` that were committed to git history in `.env`/`.env.local`/`.env-heh` before this session. (Groq key: user has said it's fine to keep using for the demo, and it's now also intentionally hardcoded as the trial fallback in `config.js` — not part of this rotation ask.)

## Dropped from this session's scope (explicitly deferred, not forgotten)

- [ ] iOS companion app
- [ ] Android companion app
- [ ] Android standalone app (on-device vector DB + offline AI — a distinct, larger build, not a packaging variant)
- [ ] Google Sign-In + cross-device encrypted sync

## The larger PRD vision (partially started — connector list)

The original AXON PRD describes a relationship-memory layer across Gmail/Slack/Discord/WhatsApp/iMessage with a Relationship Engine, semantic search, and a calm Reminder Engine. Current connector status against the prioritized list:

**Native integrations** (direct API, real-time):
- [x] Email — via generic IMAP (`connectors/emailImap.js`); works with Gmail/Outlook/365/etc. today without per-provider OAuth setup
- [ ] Gmail (OAuth-specific, richer than generic IMAP — labels, threading, etc.)
- [ ] Outlook / Microsoft 365 (OAuth-specific, same rationale)
- [ ] Slack
- [ ] Discord

**Manual imports** (no fighting platform restrictions):
- [x] WhatsApp (chat export) — `connectors/whatsappImport.js` + in-app Import panel
- [x] Email (paste) — same Import panel, `POST /api/import/email/:userId`
- [ ] iMessage (manual import / macOS export)

Plus the surrounding engine work:

- [ ] Relationship Engine (timeline, contact profiles, commitments, summaries, interaction stats) — `memoryEngine.js`/`vectorStore.js` are a starting point but scoped to single-user data today, not cross-platform relationship modeling
- [ ] Context Builder that assembles cross-platform relationship context for AI calls
- [ ] Meaning-based semantic search across all connected platforms ("What did Morgan say about the repository?")
- [ ] Reminder Engine that resurfaces context rather than issuing traditional reminders
- [ ] Multi-provider AI abstraction (Groq + Gemini key layer done; wire Gemini into inference; add Anthropic, OpenRouter, Ollama)
- [ ] Privacy Dashboard
- [ ] Ollama (fully offline) support
