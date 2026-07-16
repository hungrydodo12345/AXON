/**
 * connectors/gmailApi.js — Live Gmail connector (Gmail API, OAuth)
 *
 * Richer than the generic IMAP connector (connectors/emailImap.js):
 * uses the real Gmail API via OAuth, so it doesn't need an app
 * password and can eventually use Gmail-specific features (labels,
 * threading). Requires running `npm run connect:google` first — see
 * README "Gmail & Calendar API setup" for the full walkthrough.
 *
 * Optional: no-ops cleanly if Google OAuth credentials aren't
 * configured. Never crashes the app on failure.
 */

const { getGoogleOAuthClient } = require("./googleAuth");

const POLL_INTERVAL_MS = parseInt(process.env.GOOGLE_GMAIL_POLL_MS || "120000", 10);

function decodeBase64Url(data) {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Walk a Gmail message payload to find the best plain-text body.
 */
function extractBody(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);

    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

/**
 * Start polling Gmail for unread mail. No-ops if Google OAuth isn't
 * configured (see connectors/googleAuth.js).
 *
 * @param {object} params
 * @param {Function} params.onMessage — same signature as librarian.js's processIncomingMessage
 * @param {Function} params.onStatusChange — (status: string) => void
 */
async function startGmailConnector({ onMessage, onStatusChange }) {
  const axonUserId = process.env.GOOGLE_AXON_USER_ID;
  const auth = getGoogleOAuthClient();

  if (!auth || !axonUserId) {
    onStatusChange?.("not_configured");
    return;
  }

  let google;
  try {
    ({ google } = require("googleapis"));
  } catch (err) {
    onStatusChange?.("error");
    console.error("[GMAIL] googleapis not installed:", err.message);
    return;
  }

  const gmail = google.gmail({ version: "v1", auth });
  onStatusChange?.("connecting");

  async function pollOnce() {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: 20,
    });

    const ids = list.data.messages || [];

    for (const { id } of ids) {
      const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const headers = msg.data.payload?.headers;
      const from = getHeader(headers, "From") || "unknown@sender";
      const subject = getHeader(headers, "Subject") || "(no subject)";
      const body = extractBody(msg.data.payload) || msg.data.snippet || "";
      const dateHeader = getHeader(headers, "Date");

      await onMessage({
        platform: "gmail",
        userId: axonUserId,
        senderId: from,
        senderName: from,
        messageText: subject ? `${subject}\n\n${body}` : body,
        messageId: `gmail_${id}`,
        isGroup: false,
        timestamp: dateHeader ? new Date(dateHeader) : new Date(),
      });

      // Mark read so it isn't reprocessed next poll.
      await gmail.users.messages.modify({
        userId: "me",
        id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      }).catch(() => {});
    }
  }

  async function loop() {
    try {
      await pollOnce();
      onStatusChange?.("connected");
    } catch (err) {
      onStatusChange?.("error");
      console.error("[GMAIL] Poll failed:", err.message);
    } finally {
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  }

  loop();
}

module.exports = { startGmailConnector };
