# AXON — the website

A private, vault-based message companion for neurodivergent people and people with social anxiety. Paste a message and AXON explains what it probably means, how it sounds, and offers three calm replies. It also remembers the people in your life.

**There is no database and no account.** Everything a user owns lives in one encrypted file (a *vault*, `.axon`) that they download, keep, and re-open next time. This folder is the whole product: a static site plus one tiny optional function. **No build step. No dependencies.**

```
site/
├─ public/            ← the website (this is what gets published)
│  ├─ index.html
│  ├─ manifest.webmanifest + icons/   ← makes it installable (PWA)
│  ├─ sw.js           ← service worker: caches the app's code so it opens offline
│  ├─ _headers        ← security headers (CSP, no-referrer, …)
│  ├─ css/app.css
│  └─ js/             ← plain ES modules, no bundler
├─ functions/
│  └─ trial.mjs       ← optional: the free-trial relay (the only server code)
├─ dev-server.mjs     ← run it locally with `npm start`
└─ tests/             ← unit tests + a real-browser end-to-end test
```

---

## Deploy on Netlify (about 3 minutes)

The repo's root `netlify.toml` already points at this folder, so there's nothing to configure.

1. Push the repo to GitHub (already done if you're reading this there).
2. In Netlify: **Add new site → Import an existing project**, pick this repo and the branch you want live.
3. Leave the build settings as they are. Netlify reads them from `netlify.toml` (base `site`, publish `public`, **no build command**).
4. Click **Deploy**. That's it. The site is live.

### Turn on the "Try it free" option (optional)

The free trial uses a shared Groq key that stays on the server and never reaches visitors' browsers.

1. Netlify → **Site configuration → Environment variables → Add a variable**
2. Key `GROQ_API_KEY`, value your Groq key (get one at <https://console.groq.com/keys>).
3. **Deploys → Trigger deploy → Deploy site.**

Without the key the site works exactly the same, and "Try it free" simply shows as "Not switched on for this site". Visitors can still bring their own AI.

| Variable | Required | What it does |
|---|---|---|
| `GROQ_API_KEY` | only for the free trial | Key the trial relay uses to call Groq. |
| `AXON_TRIAL_MODEL` | no | Override the trial model (default `llama-3.3-70b-versatile`; it falls back to `llama-3.1-8b-instant` if that one is unavailable). |

### Other ways to publish

| Method | How | Free trial? |
|---|---|---|
| **Netlify Drop** (no Git) | Drag the `site/public` folder onto <https://app.netlify.com/drop> | No (static only) |
| **Netlify CLI** | `npx netlify deploy --prod --dir=site/public --functions=site/functions` | Yes |
| **Cloudflare Pages / GitHub Pages / Vercel / any static host** | Publish the `site/public` folder as-is, with no build command | No (needs the function; everything else works) |
| **Your own machine** | `cd site && npm start` → <http://localhost:8888> | Yes, with `GROQ_API_KEY=… npm start` |

All asset links are relative, so it also works from a sub-folder (for example GitHub Pages project sites). Hosts that don't read `_headers` still get a Content-Security-Policy through a `<meta>` tag in `index.html`.

---

## How it protects people

- **No server storage.** The server never receives a vault. The vault is opened in the browser, held in memory, and exported as a file on Save.
- **What the browser keeps, exactly.** (1) The app's own *code*, in the service-worker cache, so AXON opens offline. It never caches vault data, message text, API calls or anything cross-origin (tests assert this). (2) **Only if the person opts in** (Settings → Offline and this device): an *encrypted* copy of the vault in IndexedDB, the same ciphertext as a `.axon` file, plus two harmless labels (revision, save time). Nothing is written to `localStorage` or cookies, and with the opt-in off IndexedDB stays empty (an end-to-end test asserts this). The copy can be deleted any time.
- **Encryption on the device.** AES-256-GCM via the browser's Web Crypto, key from PBKDF2-SHA-256 (600,000 rounds) of the passphrase. The key is non-extractable. Header fields are bound to the ciphertext, so tampering is detected. The file reveals nothing but its size (the revision lives *inside* the encrypted payload and in the file name).
- **Bring-your-own AI goes direct.** For Groq, OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio and anything OpenAI-compatible, the browser calls the provider directly. The site's server is not involved. API keys stay in memory unless the user ticks "Remember inside my encrypted vault".
- **Free trial relay is minimal.** `functions/trial.mjs` holds the shared key, accepts only same-origin requests, caps input and output size, rate-limits per client, never logs message text and stores nothing.
- **No third parties.** No analytics, fonts, CDNs or scripts from anywhere else. A strict CSP (`script-src 'self'`) is enforced, and the UI never uses `innerHTML`, so neither pasted messages nor AI output can inject markup.
- **Only what's needed leaves the browser.** A message the user chooses to analyse, a little context about that person, and up to six recent messages with them. Imported chat history is never sent unless the user opens a message and asks.

## Install, offline and the on-device copy

- **Install:** an **Install app** button appears (top bar, start page, Settings) when the browser supports it; on iPhone/iPad it shows the Share → Add to Home Screen steps. The manifest, icons and service worker are in `public/`. After first load, AXON opens with no connection.
- **Offline:** reading, searching, people, supports and the map all work. Things that call an AI are paused with a clear message (a model on `localhost` still works).
- **Optional encrypted copy on this device:** off by default. When on, AXON autosaves the encrypted vault in the browser and the start page offers **Continue on this device**. If a vault *file* is opened while the device copy is newer, the person chooses which to use; nothing is silently overwritten. Saving a file also refreshes the device copy.
- **Shipping an update:** the service worker caches files listed in `public/sw.js`. When you add or rename a file under `public/`, add it to `SHELL` and bump `VERSION` (a unit test fails if the list is incomplete). Returning visitors get the new version quietly, and are told when it's ready.

## The map and supports

- **Supports** are each person's "what helps" list (for example "needs time to reply"), entered on the person's page. They're stored in the vault and given to the AI as context so reply ideas fit them.
- **The map** (`public/js/graph-data.js`, `graph-layout.js`, `ui/graph.js`) draws people, recurring topics, things waiting on you, and shared supports. Topics are extracted on-device (BM25-style keyword statistics, no AI). A deterministic 3D force layout is rendered on `<canvas>` with no libraries: 3D (drag to rotate), Flat, or an accessible List. Motion is opt-in (**Gentle spin**) and off for `prefers-reduced-motion`. Optional "Tidy topic names with AI" sends *only keywords*.

## The vault file

```jsonc
{
  "format": "axon-vault", "version": 1,
  "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "<b64>" },
  "cipher": "AES-256-GCM", "compression": "gzip", "iv": "<b64>",
  "data": "<b64 ciphertext of the gzipped JSON vault>"
}
```

File names look like `axon-vault_r12_2026-10-07_1430.axon`: **r12** is the revision (+1 on every save), followed by the local save time. Inside the ciphertext the vault holds the profile and settings, people, messages (with their saved analyses), per-person summaries, and (optionally) the API key. Search is plain keyword (BM25) over this data in memory, so there are no embeddings or vectors to store.

## Develop and test

```bash
cd site
npm start                 # http://localhost:8888, with the production security headers
npm test                  # 36 unit tests: crypto, parsers, search, providers, agent, trial relay, map, PWA files
node tests/e2e.mjs        # real-Chromium end-to-end run (needs Playwright; see below)
```

`tests/e2e.mjs` (47 steps) creates a vault, takes the tour, adds and imports messages, analyses with a mock provider, asks the agent, saves, closes and reopens, goes **offline**, uses the **install** flow, the **encrypted device copy** (including the file-vs-device conflict), **supports** and the **map**, and repeats key flows at phone size. It also fails if the browser console shows any error or CSP violation. Set `SHOTS=/some/folder` to keep its screenshots. It needs `playwright` and a Chromium to be resolvable (`NODE_PATH` or a global install).

## Adding a provider

Most are one line in `PRESETS` in `public/js/providers.js`. Anything that speaks the OpenAI chat-completions format needs no code. A different wire format means adding a small adapter next to `callOpenAI`, `callAnthropic` and `callGemini`.

## What this replaces

The earlier desktop prototype (Electron + Express + local JSON datastore + IMAP/Gmail pollers) is still in the repo root, untouched. It can't work as a stateless site (nothing can poll an inbox in the background), so input here is paste and import. The WhatsApp export parser and the contact/relationship ideas carried over.
