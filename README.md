# Neuro-Librarian

Social Translation Layer and Executive Function Buffer for neurodivergent users.

---

## Repo Structure

```
bridge/   → Node.js backend (WhatsApp bridge + AI engine)
ui/       → Next.js PWA (frontend, deployable to Netlify)
```

---

## Prerequisites

- Node.js 18+
- A [Groq API key](https://console.groq.com) (free)
- A [Firebase project](https://console.firebase.google.com) (free tier is fine)
- A [Resend account](https://resend.com) for email alerts (free tier)
- A [Netlify account](https://netlify.com) for UI hosting (free tier)

---

## Part 1 — Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → New project
2. Enable **Firestore Database** (production mode)
3. Go to **Project Settings → Service Accounts → Generate new private key**
4. Save the downloaded JSON — you'll need values from it for `.env`
5. Go to **Firestore → Rules** and paste the contents of `bridge/firebaseRules.json`
6. Go to **Project Settings → General** and copy your Web App config (for the UI `.env`)

---

## Part 2 — Bridge Setup (Node.js backend)

```bash
cd bridge
cp .env.example .env
```

Fill in your `.env`:

```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

GROQ_API_KEY=gsk_...

RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=safety@yourdomain.com

VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourdomain.com

AUTH_SECRET=any-random-string-minimum-32-characters-long
ALLOWED_ORIGINS=https://your-netlify-app.netlify.app

GARGOYLE_COOLDOWN_SECONDS=300
```

**Generate VAPID keys:**
```bash
npx web-push generate-vapid-keys
```

**Install and run:**
```bash
npm install
node librarian.js
```

A QR code will appear. Scan it with WhatsApp on your phone.

> ⚠️ The bridge must stay running on a persistent machine (VPS, Railway, Render, etc.) — it cannot run on Netlify. See Part 4.

---

## Part 3 — UI Setup (Next.js PWA)

```bash
cd ui
```

Create a `.env.local` file:

```
NEXT_PUBLIC_BRIDGE_URL=https://your-bridge-url.com
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-web-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

**Install and run locally:**
```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

---

## Part 4 — Deploy UI to Netlify

### Option A: Netlify CLI (fastest)

```bash
npm install -g netlify-cli
cd ui
npm run build
netlify deploy --prod --dir=.next
```

### Option B: Netlify Dashboard (recommended)

1. Push your repo to GitHub
2. Go to [Netlify](https://app.netlify.com) → **Add new site → Import from Git**
3. Select your repo
4. Set these build settings:
   - **Base directory:** `ui`
   - **Build command:** `npm run build`
   - **Publish directory:** `ui/.next`
5. Go to **Site settings → Environment variables** and add:
   ```
   NEXT_PUBLIC_BRIDGE_URL=https://your-bridge-url.com
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```
6. Click **Deploy site**
7. Go to **Site settings → Domain** to set your custom domain or use the `.netlify.app` URL

### Add netlify.toml (required for Next.js on Netlify)

Create `ui/netlify.toml`:
```toml
[build]
  base = "ui"
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

Install the Netlify Next.js plugin:
```bash
cd ui
npm install @netlify/plugin-nextjs --save-dev
```

---

## Part 5 — Deploy Bridge (Node.js backend)

The bridge cannot run on Netlify (it needs a persistent process for WhatsApp). Options:

### Railway (easiest, free tier available)
1. Go to [Railway](https://railway.app) → New Project → Deploy from GitHub
2. Select your repo → set root directory to `bridge`
3. Add all your `.env` variables in Railway's dashboard
4. Railway auto-detects Node.js and runs `node librarian.js`
5. Copy the Railway URL → set as `NEXT_PUBLIC_BRIDGE_URL` in Netlify

### Render
1. Go to [Render](https://render.com) → New Web Service
2. Connect your GitHub repo, set root to `bridge`
3. Build command: `npm install`
4. Start command: `node librarian.js`
5. Add env vars, deploy

### VPS (DigitalOcean, Hetzner, etc.)
```bash
git clone your-repo
cd your-repo/bridge
npm install
cp .env.example .env  # fill in values
# Run with PM2 for persistence
npm install -g pm2
pm2 start librarian.js --name neuro-librarian
pm2 save
pm2 startup
```

---

## Part 6 — PWA Install (Chrome shortcut)

Once deployed to Netlify:

1. Open your Netlify URL in Chrome on your phone
2. Tap the browser menu (3 dots) → **Add to Home Screen**
3. The app installs as a PWA with offline support

---

## Security checklist before going live

- [ ] `.env` is in `.gitignore` and never committed
- [ ] `AUTH_SECRET` is at least 32 random characters
- [ ] `ALLOWED_ORIGINS` is set to your exact Netlify URL
- [ ] Firebase rules are deployed (not in test mode)
- [ ] `.wwebjs_auth/` is in `.gitignore` (WhatsApp session)

---

## File count

| Location | Files |
|---|---|
| `bridge/` | 20 files |
| `ui/` | 14 files |
| Root | 3 files (.gitignore, README, netlify.toml) |
| **Total** | **37 files** |
