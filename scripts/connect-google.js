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
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // read + mark-as-read
  "https://www.googleapis.com/auth/calendar.readonly",
];

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
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

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
  console.log("You'll need a Client ID and Client Secret from Google Cloud Console.");
  console.log("Full walkthrough: see README.md → 'Gmail & Calendar API setup'.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const clientId = (await ask(rl, "Google OAuth Client ID: ")).trim();
  const clientSecret = (await ask(rl, "Google OAuth Client Secret: ")).trim();
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
