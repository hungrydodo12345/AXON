/**
 * e2e.mjs — drives the real site in Chromium.   node tests/e2e.mjs
 * Needs Playwright + a Chromium (preinstalled in this environment).
 * Uses a mock OpenAI-compatible provider on localhost to test "bring your own AI".
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { server as devServer } from "../dev-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SHOTS = process.env.SHOTS || path.join(process.cwd(), "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = "http://localhost:8899";
const MOCK_PORT = 9911;
const PASS = "maple orbit quiet bicycle";

// ── mock AI provider ──
let agentTurn = 0;
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    const sys = j.messages?.[0]?.content ?? "";
    let out = "OK";
    if (sys.includes("memory assistant")) {
      const script = [
        { action: "tool", tool: "search_messages", args: { query: "repository", person: "Morgan" } },
        { action: "answer", answer: "Morgan asked you to review the repository changes before Friday.", sources: [] },
      ];
      out = JSON.stringify(script[Math.min(agentTurn++, script.length - 1)]);
    } else if (sys.includes("Return ONLY a single JSON object")) {
      out = JSON.stringify({
        summary: "Morgan wants the repository changes reviewed before Friday.",
        plain_meaning: "Please look over the changes and say if they're okay by Friday.",
        tone: { label: "neutral", confidence: "medium", evidence: "A plain, polite request with a deadline." },
        pile: "important", needs_reply: true, reply_by: "today",
        asks: ["Review the repository changes"], dates: ["Friday"], reassurance: "",
        replies: [{ style: "warm", text: "Sure, I'll take a look today!" }, { style: "brief", text: "On it." }, { style: "boundary", text: "I can't get to this before Friday, sorry." }],
      });
    } else if (sys.includes("remember the story")) {
      out = JSON.stringify({ story: "You and Morgan work together on code reviews.", open_loops: ["Review before Friday"], remember: ["Prefers Friday deadlines"] });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
  });
});

// ── tiny test runner ──
const results = [];
let currentPage = null;
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log("  ✓", name); }
  catch (e) {
    results.push({ name, ok: false, err: e });
    console.log("  ✗", name, "\n     ", String(e.message).split("\n").slice(0, 3).join("\n      "));
    try { await currentPage?.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/\W+/g, "-").slice(0, 50)}.png`) }); } catch { /* ignore */ }
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

async function noOverflow(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (w.sw > w.iw + 1) throw new Error(`horizontal overflow on ${label}: ${w.sw} > ${w.iw}`);
}

async function unnamedControls(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")) {
      if (el.closest("[hidden], .hidden, [aria-hidden=true]")) continue;
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || el.closest("label")?.textContent.trim() || el.getAttribute("placeholder") || el.title;
      if (!name) bad.push(el.outerHTML.slice(0, 100));
    }
    return bad;
  });
}

await new Promise((r) => mock.listen(MOCK_PORT, r));
await new Promise((r) => (devServer.listening ? r() : devServer.once("listening", r)));
const browser = await chromium.launch();
const consoleProblems = [];
const watch = (page) => {
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleProblems.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => consoleProblems.push(`[pageerror] ${e.message}`));
};

let savedPath;

console.log("\nDesktop flow");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  currentPage = page;
  watch(page);
  await page.goto(`${BASE}/#debug`);

  await step("welcome screen renders with both cards and the privacy promises", async () => {
    await page.getByRole("heading", { name: /Messages, made manageable/ }).waitFor();
    await page.getByRole("heading", { name: "Start a new vault" }).waitFor();
    await page.getByRole("heading", { name: "Open my vault" }).waitFor();
    await shot(page, "01-welcome-desktop");
    await noOverflow(page, "welcome");
  });

  await step("creating a vault validates passphrase length, match and acknowledgement", async () => {
    await page.fill("#nv-name", "Alex");
    await page.fill("#nv-pass", "short");
    await page.click("button:has-text('Create my vault')");
    await page.getByText("at least 8 characters").first().waitFor();
    await page.fill("#nv-pass", PASS);
    await page.fill("#nv-pass2", "something else entirely");
    await page.click("button:has-text('Create my vault')");
    await page.getByText("don't match").waitFor();
    await page.fill("#nv-pass2", PASS);
    await page.click("button:has-text('Create my vault')");
    await page.getByText("tick the box").waitFor();
    await shot(page, "02-welcome-errors");
  });

  await step("a valid vault is created and the tour starts", async () => {
    await page.check("#nv-ack");
    await page.click("button:has-text('Create my vault')");
    await page.locator("#tour-card").waitFor();
    await page.getByRole("heading", { name: "Welcome to AXON" }).waitFor();
    await shot(page, "03-tour-welcome");
  });

  await step("the tour walks through every step, spotlighting real elements", async () => {
    const titles = [];
    for (let i = 0; i < 12; i++) {
      const title = await page.locator("#tour-title").textContent();
      await page.waitForTimeout(250); // let the scroll + spotlight settle before looking
      titles.push(title);
      if (title === "Add a message") {
        await page.getByRole("button", { name: "Load the example" }).click();
        await page.getByText("Hey! No pressure").first().waitFor();
        await shot(page, "04-tour-add");
      }
      if (title === "How it sounds") await shot(page, "05-tour-tone");
      if (title === "Reply ideas, written as you") await shot(page, "06-tour-replies");
      if (title === "Pick your AI") await shot(page, "07-tour-ai");
      if (title === "Save to keep your work") {
        await shot(page, "08-tour-save");
        break;
      }
      // spotlight should be visible on non-centered steps
      if (!["Welcome to AXON"].includes(title)) {
        const box = await page.locator(".tour-spot").boundingBox();
        if (!box || box.width < 10) throw new Error(`no spotlight on "${title}"`);
      }
      await page.click("#tour-next");
      await page.waitForFunction((t) => document.querySelector("#tour-title")?.textContent !== t, title);
    }
    if (titles.length !== 9) throw new Error(`expected 9 steps, saw ${titles.length}: ${titles.join(" | ")}`);
  });

  await step("finishing the tour removes the example data", async () => {
    await page.check("#tour-rm");
    await page.getByRole("button", { name: "Finish" }).click();
    await page.locator("#tour-card").waitFor({ state: "detached" });
    await page.getByText("Nothing here yet").waitFor();
    await shot(page, "09-inbox-empty");
  });

  await step("adding a message works without any AI and flags it as unsaved", async () => {
    await page.click("#add-message-btn");
    await page.fill("#am-who", "Morgan Lee");
    await page.fill("#am-text", "Hi! Can you review the repository changes before Friday? Thanks :)");
    await shot(page, "10-add-dialog");
    await page.click("#am-submit");
    await page.getByRole("heading", { name: "Morgan Lee" }).first().waitFor();
    await page.getByText("AXON hasn't looked at this one yet").waitFor();
    const chip = await page.locator("#vault-chip").textContent();
    if (!/Not saved yet|Unsaved/.test(chip)) throw new Error("chip should show unsaved: " + chip);
    await shot(page, "11-message-unread");
  });

  await step("without an AI, 'Make sense of this' sends you to Settings", async () => {
    await page.click("#analyze-btn");
    await page.getByRole("heading", { name: "AI connection" }).waitFor();
    if (await page.locator("#mode-trial").isEnabled()) throw new Error("trial should be disabled on this host (no key set)");
    await shot(page, "12-settings-top");
  });

  await step("bring-your-own AI: configure a custom OpenAI-compatible provider and test it", async () => {
    await page.check("#mode-custom");
    await page.getByRole("button", { name: "Other (OpenAI-compatible)" }).click();
    await page.fill("#base-url", `http://localhost:${MOCK_PORT}/v1`);
    await page.fill("#api-key", "test-key");
    await page.fill("#model-input", "mock-model");
    await page.click("#test-btn");
    await page.getByText(/Connected — it answered/).waitFor();
    await page.locator("#provider-card").scrollIntoViewIfNeeded();
    await shot(page, "13-settings-provider");
  });

  await step("settings: preset fills the toggles; toggles flip the preset to custom", async () => {
    await page.selectOption("#preset-select", "autism");
    if (!(await page.locator("#need-literal").isChecked())) throw new Error("literal should be on for autism preset");
    await page.uncheck("#need-literal", { force: true });
    if ((await page.locator("#preset-select").inputValue()) !== "custom") throw new Error("preset should become custom");
  });

  await step("analyzing a message shows summary, tone with confidence, asks and 3 replies", async () => {
    await page.click("#nav-inbox");
    await page.locator("[id^=msg-]").first().click();
    await page.click("#analyze-btn");
    await page.locator("#tone-card").waitFor();
    await page.getByText("neutral", { exact: true }).waitFor();
    await page.getByText("medium confidence").waitFor();
    await page.getByText("Review the repository changes").first().waitFor();
    if ((await page.locator(".reply-card").count()) !== 3) throw new Error("expected 3 replies");
    await shot(page, "14-analysis");
  });

  await step("copy a reply, mark it replied, and it moves to Done", async () => {
    await page.locator(".reply-card button:has-text('Copy')").first().click();
    await page.getByText(/Copied/).waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!clip.includes("Sure, I'll take a look today")) throw new Error("clipboard: " + clip);
    await page.click("#replied-btn");
    await page.getByText("Marked as replied").first().waitFor();
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator("[id^=msg-]").first().waitFor();
  });

  await step("WhatsApp import: parse, pick 'me', import, and re-import skips duplicates", async () => {
    const chat = [
      "[25/12/2025, 9:15:02 AM] Sam: Merry Christmas! Dinner at mum's on Sunday?",
      "[25/12/2025, 9:16:10 AM] Alex: Yes please, what can I bring?",
      "[25/12/2025, 9:17:00 AM] Sam: Just yourself. And maybe dessert :)",
    ].join("\n");
    for (const round of [1, 2]) {
      await page.click("#nav-inbox");
      await page.click("#add-message-btn");
      await page.getByRole("button", { name: "WhatsApp chat" }).click();
      await page.fill("#wa-paste", chat);
      await page.getByText("Found 3 messages from 2 people").waitFor();
      await page.locator("label:has-text('Alex') input[type=radio]").check({ force: true });
      if (round === 1) await shot(page, "15-whatsapp-import");
      await page.click("#am-submit");
      await page.getByText(round === 1 ? /Imported 3 messages/ : /already in your vault/).first().waitFor();
    }
    await page.click("#nav-people");
    await page.locator("[id^=person-]").filter({ hasText: "Sam" }).first().click();
    await page.getByText("Dinner at mum's on Sunday?").first().waitFor();
    await page.getByText("What can I bring?").first().waitFor();
    await shot(page, "16-people-detail");
  });

  await step("people: edit a person, categories group into Work and Personal", async () => {
    await page.click("#nav-people");
    await page.click("#add-person-btn");
    await page.fill("#pp-name", "Dr. Okafor");
    await page.getByRole("button", { name: "Work" }).click();
    await page.fill("#pp-rel", "Doctor");
    await page.locator("dialog").getByRole("button", { name: "Add person" }).click();
    await page.getByRole("heading", { name: "Dr. Okafor" }).waitFor();
    await shot(page, "17-people-work");
  });

  await step("ask: the agent searches the vault, shows its steps, and answers", async () => {
    await page.click("#nav-ask");
    await page.fill("#ask-input", "What did Morgan say about the repository?");
    await page.click("#ask-btn");
    await page.getByText("Morgan asked you to review the repository changes before Friday.").waitFor();
    await page.getByText(/Searched messages for/).waitFor();
    await shot(page, "18-ask");
  });

  await step("search works with no AI: ranks the right message and opens it", async () => {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.fill("#search-input", "dessert");
    await page.getByText("Just yourself. And maybe dessert").waitFor();
    await shot(page, "19-search");
    await page.locator(".hit").first().click();
    await page.getByRole("heading", { name: "Sam" }).first().waitFor();
  });

  await step("help dialog opens, navigates sections and closes with Escape", async () => {
    await page.click("#help-btn");
    await page.getByRole("heading", { name: "How AXON works" }).waitFor();
    await page.locator(".help-toc button", { hasText: "Privacy and security" }).click();
    await shot(page, "20-help");
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
  });

  await step("saving downloads a revisioned, timestamped, encrypted file (no plaintext inside)", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save-btn")]);
    const name = download.suggestedFilename();
    if (!/^axon-vault_r1_\d{4}-\d{2}-\d{2}_\d{4}\.axon$/.test(name)) throw new Error("bad filename " + name);
    savedPath = path.join(SHOTS, name);
    await download.saveAs(savedPath);
    const text = fs.readFileSync(savedPath, "utf8");
    for (const secret of ["Morgan", "repository", "Sam", "test-key", "mock-model", "Okafor"]) {
      if (text.includes(secret)) throw new Error(`plaintext leaked: ${secret}`);
    }
    const f = JSON.parse(text);
    if (f.format !== "axon-vault" || f.cipher !== "AES-256-GCM") throw new Error("unexpected header");
    await page.getByText(/Saved as axon-vault_r1/).waitFor();
    const chip = await page.locator("#vault-chip").textContent();
    if (!/Revision 1/.test(chip)) throw new Error("chip: " + chip);
  });

  await step("the API key is NOT in the saved file unless 'remember' is ticked", async () => {
    // already verified 'test-key' absent above; now confirm it's still usable in memory
    await page.click("#nav-settings");
    const val = await page.inputValue("#api-key");
    if (val !== "test-key") throw new Error("key should remain in memory this session");
  });

  await step("closing a clean vault clears memory and returns to the welcome screen", async () => {
    await page.click("#lock-btn");
    await page.getByRole("heading", { name: "Start a new vault" }).waitFor();
    const left = await page.evaluate(() => window.__axon.app.vault);
    if (left !== null) throw new Error("vault should be null after close");
    const storage = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie }));
    if (storage.ls || storage.ss || storage.ck) throw new Error("nothing should ever be stored in the browser: " + JSON.stringify(storage));
  });

  await step("reopening: wrong passphrase is rejected, right passphrase restores everything", async () => {
    await page.setInputFiles("#ov-file", savedPath);
    await page.fill("#ov-pass", "definitely wrong passphrase");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByText(/doesn't open this vault/).waitFor();
    await shot(page, "21-wrong-passphrase");
    await page.fill("#ov-pass", PASS);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByRole("heading", { name: "Inbox" }).waitFor();
    await page.getByText(/Revision 1/).first().waitFor();
    await page.click("#nav-people");
    await page.getByRole("button", { name: /Morgan Lee/ }).waitFor();
    await page.getByRole("button", { name: /Dr\. Okafor/ }).waitFor();
    // analysis survived the round trip
    await page.click("#nav-inbox");
    await page.getByRole("button", { name: "All" }).click();
    await page.locator("[id^=msg-]").filter({ hasText: "Morgan Lee" }).first().click();
    await page.locator("#tone-card").waitFor();
  });

  await step("second save bumps the revision to r2", async () => {
    await page.click("#nav-people");
    await page.getByRole("button", { name: /Morgan Lee/ }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.fill("#pp-notes", "Prefers short messages.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    if (!/Unsaved/.test(await page.locator("#vault-chip").textContent())) throw new Error("should be dirty");
    const [d] = await Promise.all([page.waitForEvent("download"), page.click("#save-btn")]);
    if (!/_r2_/.test(d.suggestedFilename())) throw new Error(d.suggestedFilename());
  });

  await step("closing a dirty vault asks first", async () => {
    await page.click("#nav-settings");
    await page.fill("#name-input", "Alexandra");
    await page.click("#lock-btn");
    await page.getByRole("heading", { name: "Save before closing?" }).waitFor();
    await shot(page, "22-close-dirty");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
  });

  await step("dark theme renders", async () => {
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.click("#nav-inbox");
    await page.getByRole("button", { name: "All" }).click();
    await shot(page, "23-dark");
  });

  await step("every control has an accessible name", async () => {
    for (const v of ["inbox", "people", "ask", "settings"]) {
      await page.click(`#nav-${v}`);
      const bad = await unnamedControls(page);
      if (bad.length) throw new Error(`${v}: ${bad.join(" || ")}`);
    }
  });

  await ctx.close();
}

console.log("\nMobile flow");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  currentPage = page;
  watch(page);
  await page.goto(`${BASE}/#debug`);

  await step("welcome fits a phone with no sideways scrolling", async () => {
    await page.getByRole("heading", { name: /Messages, made manageable/ }).waitFor();
    await shot(page, "m01-welcome");
    await noOverflow(page, "mobile welcome");
  });

  await step("open vault on mobile and see the inbox with bottom navigation", async () => {
    await page.setInputFiles("#ov-file", savedPath);
    await page.fill("#ov-pass", PASS);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByRole("heading", { name: "Inbox" }).waitFor();
    await page.getByRole("button", { name: "All" }).click();
    await shot(page, "m02-inbox");
    await noOverflow(page, "mobile inbox");
    const nav = await page.locator(".navrail").boundingBox();
    if (!nav || nav.y < 600) throw new Error("nav should be at the bottom on mobile: " + JSON.stringify(nav));
  });

  await step("message detail takes the full screen with a Back button", async () => {
    await page.locator("[id^=msg-]").filter({ hasText: "Morgan Lee" }).first().click();
    await page.locator("#tone-card").waitFor();
    await shot(page, "m03-detail");
    await noOverflow(page, "mobile detail");
    await page.getByRole("button", { name: "All messages" }).click();
    await page.locator(".list").waitFor();
  });

  await step("people, ask, settings and help are usable on mobile", async () => {
    for (const v of ["people", "ask", "settings"]) {
      await page.click(`#nav-${v}`);
      await shot(page, `m04-${v}`);
      await noOverflow(page, `mobile ${v}`);
    }
    await page.click("#help-btn");
    await page.getByRole("heading", { name: "How AXON works" }).waitFor();
    await shot(page, "m05-help");
    await noOverflow(page, "mobile help");
    await page.keyboard.press("Escape");
  });

  await step("add-message dialog fits on a phone", async () => {
    await page.click("#nav-inbox");
    await page.click("#add-message-btn");
    await shot(page, "m06-add");
    const box = await page.locator(".dialog-box").boundingBox();
    if (box.x < 0 || box.x + box.width > 391) throw new Error("dialog overflows: " + JSON.stringify(box));
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await ctx.close();
}

console.log("\nMobile tour");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  currentPage = page;
  watch(page);
  await page.goto(`${BASE}/#debug`);
  await step("new vault on a phone starts the tour; card and spotlight stay on screen at every step", async () => {
    await page.fill("#nv-pass", PASS);
    await page.fill("#nv-pass2", PASS);
    await page.check("#nv-ack");
    await page.click("button:has-text('Create my vault')");
    await page.locator("#tour-card").waitFor();
    for (let i = 0; i < 9; i++) {
      const title = await page.locator("#tour-title").textContent();
      if (title === "Add a message") await page.getByRole("button", { name: "Load the example" }).click();
      await page.waitForTimeout(150);
      const card = await page.locator("#tour-card").boundingBox();
      if (card.x < -1 || card.y < -1 || card.x + card.width > 391 || card.y + card.height > 845) throw new Error(`card off-screen on "${title}": ${JSON.stringify(card)}`);
      const spot = await page.locator(".tour-spot:not(.none)").boundingBox().catch(() => null);
      if (spot && (spot.x + spot.width < 0 || spot.x > 390 || spot.y + spot.height < 0 || spot.y > 844)) throw new Error(`spotlight off-screen on "${title}": ${JSON.stringify(spot)}`);
      if (i === 0 || i === 3 || i === 5 || i === 7) await shot(page, `m07-tour-${i + 1}`);
      if (title === "Save to keep your work") break;
      await page.click("#tour-next");
      await page.waitForFunction((t) => document.querySelector("#tour-title")?.textContent !== t, title);
    }
    await page.getByRole("button", { name: "Finish" }).click();
    await page.locator("#tour-card").waitFor({ state: "detached" });
    await noOverflow(page, "after mobile tour");
  });
  await ctx.close();
}

await browser.close();
mock.close();
devServer.close();

console.log("\nBrowser console problems:", consoleProblems.length);
for (const p of [...new Set(consoleProblems)]) console.log("  ", p);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed.`);
process.exit(failed.length || consoleProblems.length ? 1 : 0);
