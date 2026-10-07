/**
 * make-brochure.mjs — builds docs/AXON-brochure.pdf from the real running site.
 *
 *   cd site && PORT=8899 node docs/make-brochure.mjs
 *
 * 1. starts the dev server, 2. captures clean screenshots (using the built-in
 * example message, so no real data is ever involved), 3. prints brochure.html to PDF.
 * Needs Playwright + Chromium (resolvable via NODE_PATH or a global install).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { server } from "../dev-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = `http://localhost:${process.env.PORT || 8888}`;
const img = path.join(here, "img");
fs.mkdirSync(img, { recursive: true });

await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
const browser = await chromium.launch();

async function openWithExample(viewport, { mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(BASE);
  await page.fill("#nv-name", "Alex");
  await page.fill("#nv-pass", "maple orbit quiet bicycle");
  await page.fill("#nv-pass2", "maple orbit quiet bicycle");
  await page.check("#nv-ack");
  await page.click("button:has-text('Create my vault')");
  await page.locator("#tour-card").waitFor();
  await page.keyboard.press("Escape"); // skip the tour
  await page.locator("#tour-card").waitFor({ state: "detached" });
  await page.click("#try-sample-btn");
  await page.locator("#tone-card").waitFor();
  await page.evaluate(() => { const t = document.getElementById("toasts"); t.hidden = true; t.replaceChildren(); });
  await page.waitForTimeout(400);
  return { ctx, page };
}

// desktop hero: the inbox with an analysed example
{
  const { ctx, page } = await openWithExample({ width: 1280, height: 1000 });
  await page.screenshot({ path: path.join(img, "analysis-desktop.png"), clip: { x: 0, y: 0, width: 1280, height: 960 } });
  await ctx.close();
}
// mobile: the analysed message
{
  const { ctx, page } = await openWithExample({ width: 390, height: 844 }, { mobile: true });
  await page.evaluate(() => { const q = document.querySelector(".quote"); window.scrollTo(0, q.getBoundingClientRect().top + window.scrollY - 84); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(img, "analysis-mobile.png") });
  await ctx.close();
}

// PDF
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, "brochure.html")).href);
await page.waitForLoadState("load");
const out = path.join(here, "AXON-brochure.pdf");
await page.pdf({ path: out, format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
await browser.close();
server.close();
console.log("wrote", out, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
