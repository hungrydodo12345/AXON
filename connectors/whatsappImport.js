/**
 * connectors/whatsappImport.js — WhatsApp chat-export parser
 *
 * WhatsApp has no personal-account API, so this is a manual import:
 * user exports a chat from the WhatsApp app ("Export Chat" → without
 * media) and pastes/uploads the resulting .txt file.
 *
 * Handles both common export formats:
 *   iOS:     [DD/MM/YYYY, HH:MM:SS] Sender Name: Message text
 *   Android: DD/MM/YYYY, HH:MM - Sender Name: Message text
 * (12h "AM/PM" and 24h timestamps both supported.)
 *
 * Multi-line messages (a line that isn't a new timestamped entry) are
 * appended to the previous message.
 */

const LINE_PATTERNS = [
  // iOS: [12/31/24, 11:59:00 PM] Name: text
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]\s([^:]+):\s(.*)$/,
  // Android: 12/31/24, 11:59 PM - Name: text
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s-\s([^:]+):\s(.*)$/,
];

const SYSTEM_MESSAGE_MARKERS = [
  "Messages and calls are end-to-end encrypted",
  "created group",
  "changed the subject",
  "added",
  "left",
  "changed this group's icon",
  "You deleted this message",
  "This message was deleted",
];

function parseTimestamp(dateStr, timeStr) {
  // Normalize "12:34" / "12:34:56" / "12:34 PM" into something Date can parse,
  // trying DD/MM/YYYY first (WhatsApp's usual default) then MM/DD/YYYY.
  const [a, b, yRaw] = dateStr.split("/").map((s) => s.trim());
  const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;

  const candidates = [
    `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}T00:00:00`, // DD/MM/YYYY
    `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}T00:00:00`, // MM/DD/YYYY
  ];

  for (const iso of candidates) {
    const base = new Date(iso);
    if (!isNaN(base.getTime())) {
      const time = parseTimeOfDay(timeStr);
      if (time) {
        base.setHours(time.hours, time.minutes, time.seconds || 0, 0);
      }
      return base;
    }
  }
  return null;
}

function parseTimeOfDay(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp][Mm])?$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return { hours, minutes, seconds };
}

function isSystemMessage(text) {
  return SYSTEM_MESSAGE_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Parse a WhatsApp chat-export .txt file's contents.
 * @param {string} rawText
 * @returns {Array<{ sender: string, text: string, timestamp: Date|null }>}
 */
function parseWhatsAppExport(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  // Strip WhatsApp's invisible LTR/RTL mark characters that show up in exports.
  const cleaned = rawText.replace(/[‎‏]/g, "");
  const lines = cleaned.split(/\r?\n/);

  const messages = [];
  let current = null;

  for (const line of lines) {
    let matched = null;
    for (const pattern of LINE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        matched = m;
        break;
      }
    }

    if (matched) {
      const [, dateStr, timeStr, sender, text] = matched;

      if (isSystemMessage(text)) {
        current = null;
        continue;
      }

      current = {
        sender: sender.trim(),
        text: text.trim(),
        timestamp: parseTimestamp(dateStr, timeStr),
      };
      messages.push(current);
    } else if (current && line.trim()) {
      // Continuation of a multi-line message
      current.text += `\n${line.trim()}`;
    }
  }

  return messages.filter((m) => m.text.length > 0);
}

module.exports = { parseWhatsAppExport };
