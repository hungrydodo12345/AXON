/**
 * dev-server.mjs — run AXON locally with zero dependencies:  node dev-server.mjs
 *
 * Serves public/, applies the same security headers as production (public/_headers),
 * and mounts the Netlify function at /api/trial. Great for trying the site on your
 * own machine (or for hosts that can run a tiny Node server).
 *
 *   PORT=8888 node dev-server.mjs
 *   GROQ_API_KEY=gsk_... node dev-server.mjs     # switch the free trial on locally
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import trial from "./functions/trial.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 8888;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png",
  ".ico": "image/x-icon", ".pdf": "application/pdf", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

async function loadHeaders() {
  try {
    const text = await readFile(path.join(root, "_headers"), "utf8");
    const headers = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
      if (m) headers[m[1]] = m[2].trim();
    }
    return headers;
  } catch {
    return {};
  }
}
const secHeaders = await loadHeaders();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/trial") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await trial(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }

    let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let full = path.join(root, file);
    if (!full.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
    try {
      if ((await stat(full)).isDirectory()) full = path.join(full, "index.html");
    } catch {
      if (!path.extname(full)) full = path.join(root, "index.html");
    }
    const data = await readFile(full);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...secHeaders });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, () => console.log(`AXON running at http://localhost:${PORT}  (free trial ${process.env.GROQ_API_KEY ? "ON" : "off — set GROQ_API_KEY to enable"})`));
export { server };
