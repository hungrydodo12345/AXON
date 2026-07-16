/**
 * connectors/emailImap.js — Live email connector (IMAP)
 *
 * Works with any IMAP provider (Gmail, Outlook/Microsoft 365, Yahoo,
 * iCloud, etc.) using an app password — no per-provider OAuth app
 * registration needed, so this works today without any Google
 * Cloud / Azure setup.
 *
 * Optional: only activates if EMAIL_IMAP_* env vars are set. Any
 * connection failure is logged and reported via onStatusChange —
 * never crashes the rest of AXON (mirrors how the app treats every
 * other optional connector).
 *
 * Gmail: use an App Password (myaccount.google.com/apppasswords),
 *        host imap.gmail.com, port 993, secure true.
 * Outlook/365: host outlook.office365.com, port 993, secure true,
 *        an App Password if MFA is on.
 */

const POLL_INTERVAL_MS = parseInt(process.env.EMAIL_IMAP_POLL_MS || "120000", 10); // 2 min default

function getImapConfig() {
  const host = process.env.EMAIL_IMAP_HOST;
  const user = process.env.EMAIL_IMAP_USER;
  const password = process.env.EMAIL_IMAP_PASSWORD;
  const axonUserId = process.env.EMAIL_IMAP_AXON_USER_ID;

  if (!host || !user || !password || !axonUserId) return null;

  return {
    host,
    port: parseInt(process.env.EMAIL_IMAP_PORT || "993", 10),
    secure: process.env.EMAIL_IMAP_SECURE !== "false",
    auth: { user, pass: password },
    axonUserId,
  };
}

/**
 * Start polling an IMAP inbox for new mail. No-ops (resolves
 * immediately) if EMAIL_IMAP_* env vars aren't set.
 *
 * @param {object} params
 * @param {Function} params.onMessage — same signature as librarian.js's processIncomingMessage
 * @param {Function} params.onStatusChange — (status: string) => void
 */
async function startEmailImapConnector({ onMessage, onStatusChange }) {
  const config = getImapConfig();

  if (!config) {
    onStatusChange?.("not_configured");
    return;
  }

  // Lazy-require so imapflow/mailparser are only needed when this
  // connector is actually configured.
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require("imapflow"));
    ({ simpleParser } = require("mailparser"));
  } catch (err) {
    onStatusChange?.("error");
    console.error("[EMAIL] imapflow/mailparser not installed:", err.message);
    return;
  }

  let lastSeenUid = 0;
  onStatusChange?.("connecting");

  async function pollOnce() {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      logger: false,
    });

    try {
      await client.connect();
      onStatusChange?.("connected");

      const lock = await client.getMailboxLock("INBOX");
      try {
        const searchCriteria = lastSeenUid > 0 ? { uid: `${lastSeenUid + 1}:*` } : { seen: false };

        for await (const message of client.fetch(searchCriteria, { uid: true, source: true })) {
          if (message.uid <= lastSeenUid) continue;
          lastSeenUid = Math.max(lastSeenUid, message.uid);

          const parsed = await simpleParser(message.source);
          const from = parsed.from?.text || "unknown@sender";
          const subject = parsed.subject || "(no subject)";
          const body = (parsed.text || parsed.html || "").trim();

          await onMessage({
            platform: "email",
            userId: config.axonUserId,
            senderId: from,
            senderName: parsed.from?.value?.[0]?.name || from,
            messageText: subject ? `${subject}\n\n${body}` : body,
            messageId: `email_${message.uid}_${parsed.messageId || Date.now()}`,
            isGroup: false,
            timestamp: parsed.date || new Date(),
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async function loop() {
    try {
      await pollOnce();
      onStatusChange?.("connected");
    } catch (err) {
      onStatusChange?.("error");
      console.error("[EMAIL] Poll failed:", err.message);
    } finally {
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  }

  loop();
}

module.exports = { startEmailImapConnector };
