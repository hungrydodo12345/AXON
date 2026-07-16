#!/usr/bin/env node
/**
 * scripts/connect-google.js — Gmail + Calendar OAuth setup
 *
 * Finishes the walkthrough in README "Gmail & Calendar API setup":
 * takes the Client ID / Client Secret you got from Google Cloud
 * Console, runs the actual OAuth consent flow (opens your browser,
 * catches the redirect locally, exchanges the code for a refresh
 * token), and writes everything AXON needs into .env.
 *
 * Usage: npm run connect:google
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
const { execFile } = require("child_process");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(ROOT, ".env.example");
const REDIRECT_PORT = 51823;
// Desktop-app OAuth clients register a bare "http://localhost" redirect
// (see the client_secret.json Google gives you) — the loopback flow
// (RFC 8252) lets any port work as long as the host matches, so this
// stays compatible with that registration without needing a path.
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // read + mark-as-read
  "https://www.googleapis.com/auth/calendar.readonly",
];

/**
 * Look for a Google-downloaded client_secret*.json in the project
 * root and pull client_id/client_secret out of it, so you don't have
 * to copy-paste them by hand. Supports both "installed" (Desktop app)
 * and "web" shapes.
 */
function findClientSecretFile() {
  const match = fs.readdirSync(ROOT).find((f) => /^client_secret.*\.json$/.test(f));
  if (!match) return null;

  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, match), "utf8"));
    const creds = data.installed || data.web;
    if (!creds?.client_id || !creds?.client_secret) return null;
    return { clientId: creds.client_id, clientSecret: creds.client_secret, file: match };
  } catch {
    return null;
  }
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, (err) => {
    if (err) console.log(`Couldn't open a browser automatically. Open this URL yourself:\n  ${url}`);
  });
}

function ensureEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    const seed = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, "utf8") : "";
    fs.writeFileSync(ENV_PATH, seed);
    console.log("Created .env from .env.example.");
  }
}

function writeEnvValues(pairs) {
  ensureEnvFile();
  let lines = fs.readFileSync(ENV_PATH, "utf8").split("\n");

  for (const [key, value] of Object.entries(pairs)) {
    const pattern = new RegExp(`^${key}=`);
    let found = false;
    lines = lines.map((line) => {
      if (pattern.test(line)) { found = true; return `${key}=${value}`; }
      return line;
    });
    if (!found) lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, lines.join("\n"));
}

function waitForOAuthCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (!code && !error) {
        res.writeHead(204).end(); // e.g. favicon requests — ignore, keep waiting
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(error
        ? `<h2>AXON: Google sign-in failed (${error}). You can close this tab.</h2>`
        : `<h2>AXON: connected. You can close this tab and go back to the terminal.</h2>`);

      server.close();
      if (error) reject(new Error(error));
      else resolve(code);
    });

    server.listen(REDIRECT_PORT);
  });
}

async function main() {
  let google;
  try {
    ({ google } = require("googleapis"));
  } catch {
    console.error("googleapis isn't installed. Run `npm install` first, then try again.");
    process.exit(1);
  }

  console.log("AXON — Gmail + Calendar connection\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let clientId, clientSecret;
  const fromFile = findClientSecretFile();

  if (fromFile) {
    console.log(`Found ${fromFile.file} in the project root — using its Client ID/Secret.`);
    ({ clientId, clientSecret } = fromFile);
  } else {
    console.log("You'll need a Client ID and Client Secret from Google Cloud Console.");
    console.log("Full walkthrough: see README.md → 'Gmail & Calendar API setup'.");
    console.log("(Tip: drop your downloaded client_secret*.json into the project root and this step is skipped next time.)\n");
    clientId = (await ask(rl, "Google OAuth Client ID: ")).trim();
    clientSecret = (await ask(rl, "Google OAuth Client Secret: ")).trim();
  }

  const axonUserId = (await ask(rl, "Which AXON account should Gmail attach to? (the phone number/id you used at onboarding): ")).trim();

  if (!clientId || !clientSecret || !axonUserId) {
    console.log("Missing input — nothing was saved. Run `npm run connect:google` again when ready.");
    rl.close();
    return;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even if you've authorized before
    scope: SCOPES,
  });

  console.log("\nOpening your browser to sign in with Google and approve access...");
  console.log(`If it doesn't open, visit:\n  ${authUrl}\n`);
  openInBrowser(authUrl);

  let code;
  try {
    code = await waitForOAuthCallback();
  } catch (err) {
    console.error(`Google sign-in failed: ${err.message}`);
    rl.close();
    return;
  }

  const { tokens } = await oauth2Client.getToken(code);
  rl.close();

  if (!tokens.refresh_token) {
    console.log(
      "\nGoogle didn't return a refresh token (this happens if you've already " +
      "authorized this app before). Go to https://myaccount.google.com/permissions, " +
      "remove AXON's access, and run `npm run connect:google` again."
    );
    return;
  }

  writeEnvValues({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
    GOOGLE_AXON_USER_ID: axonUserId,
  });

  console.log("\nConnected. Gmail and Calendar will pick this up next time AXON starts.");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
