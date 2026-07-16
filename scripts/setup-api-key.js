#!/usr/bin/env node
/**
 * scripts/setup-api-key.js — Interactive AI provider key setup
 *
 * Walks a non-technical user through getting a free Groq or Gemini
 * API key: opens the right signup/key page in their browser, waits
 * for them to paste the key, and writes it into .env. No accounts,
 * no dashboards — just the one field AXON actually needs.
 *
 * Usage: npm run setup:key
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(ROOT, ".env.example");

const PROVIDERS = {
  1: {
    name: "Groq",
    envKey: "GROQ_API_KEY",
    url: "https://console.groq.com/keys",
    note: "Free tier, fast — recommended default.",
  },
  2: {
    name: "Gemini",
    envKey: "GEMINI_API_KEY",
    url: "https://aistudio.google.com/apikey",
    note: "Google's Gemini API — also has a free tier.",
  },
};

function openInBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];

  execFile(cmd, args, (err) => {
    if (err) {
      console.log(`Couldn't open a browser automatically. Open this URL yourself:\n  ${url}`);
    }
  });
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function ensureEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    const seed = fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, "utf8")
      : "";
    fs.writeFileSync(ENV_PATH, seed);
    console.log("Created .env from .env.example.");
  }
}

function writeEnvValue(envKey, value) {
  ensureEnvFile();
  const lines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
  const pattern = new RegExp(`^${envKey}=`);
  let found = false;

  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return `${envKey}=${value}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${envKey}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, updated.join("\n"));
}

async function main() {
  console.log("AXON — AI provider key setup\n");
  console.log("1) Groq  (free, fast — recommended)");
  console.log("2) Gemini (Google's API, also free tier)\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let choice = (await ask(rl, "Which provider? [1/2, default 1]: ")).trim() || "1";
  const provider = PROVIDERS[choice] || PROVIDERS[1];

  console.log(`\n${provider.name}: ${provider.note}`);
  console.log(`Opening ${provider.url} — sign in, create a key, and copy it.\n`);
  openInBrowser(provider.url);

  const key = (await ask(rl, `Paste your ${provider.name} API key here: `)).trim();
  rl.close();

  if (!key) {
    console.log("No key entered — nothing was saved. Run `npm run setup:key` again when you're ready.");
    return;
  }

  writeEnvValue(provider.envKey, key);
  console.log(`\nSaved ${provider.envKey} to .env. AXON will use it on the next launch.`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
