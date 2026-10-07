/**
 * whatsapp.js — parse a WhatsApp "Export chat" .txt file (no media).
 *
 * Handles iOS "[12/31/24, 11:59:00 PM] Name: text" and Android
 * "12/31/24, 11:59 PM - Name: text", 12h and 24h clocks, multi-line messages,
 * and skips system lines. Ported from the original desktop connector so the
 * website needs no server for this.
 */

const LINE_PATTERNS = [
  /^\[(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),?\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\]\s([^:]+):\s(.*)$/,
  /^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),?\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\s-\s([^:]+):\s(.*)$/,
];

const SYSTEM_MARKERS = [
  "Messages and calls are end-to-end encrypted",
  "created group",
  "changed the subject",
  "changed this group's icon",
  "You deleted this message",
  "This message was deleted",
  "<Media omitted>",
  "image omitted",
  "video omitted",
  "sticker omitted",
  "audio omitted",
];

function parseTimeOfDay(str) {
  const m = str.replace(/\./g, "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp][Mm])?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = m[3] ? parseInt(m[3], 10) : 0;
  const mer = m[4]?.toLowerCase();
  if (mer === "pm" && hours < 12) hours += 12;
  if (mer === "am" && hours === 12) hours = 0;
  return { hours, minutes, seconds };
}

/**
 * WhatsApp date order varies by phone locale. We first look at the whole file
 * to decide DD/MM vs MM/DD (any number > 12 settles it), then parse consistently.
 */
function detectDayFirst(lines) {
  for (const line of lines) {
    for (const p of LINE_PATTERNS) {
      const m = line.match(p);
      if (!m) continue;
      const [a, b] = m[1].split(/[/.]/).map(Number);
      if (a > 12) return true;
      if (b > 12) return false;
    }
  }
  return true; // ambiguous (every date ≤ 12): day-first is WhatsApp's most common default
}

function toDate(dateStr, timeStr, dayFirst) {
  const parts = dateStr.split(/[/.]/).map((s) => parseInt(s, 10));
  let [a, b, y] = parts;
  if (y < 100) y += 2000;
  const day = dayFirst ? a : b;
  const month = dayFirst ? b : a;
  const t = parseTimeOfDay(timeStr);
  if (!t) return null;
  const d = new Date(y, month - 1, day, t.hours, t.minutes, t.seconds);
  return isNaN(d) ? null : d;
}

/** @returns {Array<{sender:string,text:string,timestamp:Date|null}>} */
export function parseWhatsAppExport(raw) {
  if (!raw || typeof raw !== "string") return [];
  const cleaned = raw.replace(/[‎‏‪-‮]/g, "").replace(/^﻿/, "");
  const lines = cleaned.split(/\r?\n/);
  const dayFirst = detectDayFirst(lines);
  const out = [];
  let current = null;

  for (const line of lines) {
    let m = null;
    for (const p of LINE_PATTERNS) {
      m = line.match(p);
      if (m) break;
    }
    if (m) {
      const [, dateStr, timeStr, sender, text] = m;
      if (SYSTEM_MARKERS.some((s) => text.includes(s))) {
        current = null;
        continue;
      }
      current = { sender: sender.trim(), text: text.trim(), timestamp: toDate(dateStr, timeStr, dayFirst) };
      out.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line.trim()}`;
    }
  }
  return out.filter((x) => x.text.length > 0);
}
