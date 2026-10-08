/**
 * make-icons.mjs — renders the PWA icons (public/icons/*.png) from the logo.
 *   cd site && node docs/make-icons.mjs
 * Needs Playwright + Chromium (via NODE_PATH or a global install).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
fs.mkdirSync(out, { recursive: true });

// `pad` shrinks the mark so maskable icons keep it inside the safe zone.
const svg = (size, { rounded, pad }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  ${rounded ? '<rect width="64" height="64" rx="14" fill="#3556c8"/>' : '<rect width="64" height="64" fill="#3556c8"/>'}
  <g transform="translate(32 32) scale(${1 - pad}) translate(-32 -32)">
    <path d="M20 46 32 18l12 28M25 37h14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const jobs = [
  ["icon-192.png", 192, { rounded: true, pad: 0 }],
  ["icon-512.png", 512, { rounded: true, pad: 0 }],
  ["maskable-512.png", 512, { rounded: false, pad: 0.22 }],
  ["apple-touch-icon.png", 180, { rounded: false, pad: 0.1 }], // iOS rounds the corners itself
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, opts] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, opts)}</body>`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true });
  console.log("wrote", name);
}
await browser.close();
