/**
 * utils.js — tiny DOM + formatting helpers.
 *
 * Privacy/safety rule for the whole app: we NEVER use innerHTML. Everything
 * (including model output and pasted messages) is rendered through `h()` as
 * text nodes, so nothing a message or an AI says can inject markup or script.
 */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === "class") el.className = val;
    else if (key === "text") el.textContent = val;
    else if (key === "dataset") Object.assign(el.dataset, val);
    else if (key.startsWith("on") && typeof val === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === "value" || key === "checked" || key === "disabled" || key === "hidden" || key === "open") {
      el[key] = val;
    } else if (val === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(val));
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Small stable string hash (cyrb53) — used to de-duplicate re-imported chats. */
export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clip(text, max) {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function fmtWhen(ts, now = new Date()) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${timeFmt.format(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${timeFmt.format(d)}`;
  return d.getFullYear() === now.getFullYear() ? dateFmt.format(d) : dateYearFmt.format(d);
}

export function fmtFull(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "" : fullFmt.format(d);
}

const preciseFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
/** Like fmtFull but with seconds — for choices where two times can fall in the same minute. */
export function fmtPrecise(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "" : preciseFmt.format(d);
}

export function fmtAgo(ts, now = Date.now()) {
  const d = new Date(ts).getTime();
  if (isNaN(d)) return "";
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h("textarea", { "aria-hidden": "true", tabindex: "-1" });
    ta.value = text;
    ta.className = "sr-offscreen";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, "aria-hidden": "true", tabindex: "-1" });
  a.className = "sr-offscreen";
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

export function pluralize(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

export function readFileText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
