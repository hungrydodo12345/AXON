/**
 * wuphf.js — WUPHF / Retainer System + Calendar Extraction
 *
 * Features:
 *   1. Auto-nudge reminders for VIP/Work inactivity
 *   2. Calendar event detection → one-tap "Add to Calendar" links
 *
 * Runs on a cron schedule via node-cron.
 * Constitutional compliance: PRIVACY_ABSOLUTE — all data stays in user's Firestore.
 */

const cron = require("node-cron");
const admin = require("firebase-admin");
const { getDb } = require("./firebaseSchema");

// ============================================================
// NUDGE SYSTEM
// ============================================================

/**
 * Check all users for VIP/Work contacts that haven't been replied to.
 * Emits nudge events to the SSE stream.
 *
 * @param {Function} emitToUser — SSE emitter function from librarian.js
 */
async function runNudgeCheck(emitToUser) {
  try {
    const usersSnapshot = await getDb().collection("users").get();

    for (const userDoc of usersSnapshot.docs) {
      const profile = userDoc.data();
      const userId = userDoc.id;

      if (!profile.nudge_settings) continue;

      const vipHours = profile.nudge_settings.vip_inactivity_hours || 24;
      const workHours = profile.nudge_settings.work_inactivity_hours || 48;

      // Get unreplied messages
      const messagesSnapshot = await getDb()
        .collection("users")
        .doc(userId)
        .collection("messages")
        .where("replied", "==", false)
        .where("read", "==", true)
        .get();

      for (const msgDoc of messagesSnapshot.docs) {
        const msg = msgDoc.data();
        const createdAt = msg.created_at?.toDate ? msg.created_at.toDate() : null;
        if (!createdAt) continue;

        const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        const senderBucket = getBucketForSender(msg.from, profile.contact_buckets);

        let shouldNudge = false;
        let urgency = "low";

        if (senderBucket === "vip" && hoursSince >= vipHours) {
          shouldNudge = true;
          urgency = "high";
        } else if (senderBucket === "work" && hoursSince >= workHours) {
          shouldNudge = true;
          urgency = "medium";
        }

        if (shouldNudge) {
          emitToUser(userId, {
            type: "nudge",
            urgency,
            message_id: msgDoc.id,
            from: msg.from,
            bucket: senderBucket,
            hours_waiting: Math.round(hoursSince),
            // Neutral, no-guilt language per ADHD constitution
            text: `You have an unreplied message from ${senderBucket} contact (${Math.round(hoursSince)}h ago).`,
          });
        }
      }
    }
  } catch (err) {
    console.error("[WUPHF] Nudge check failed:", err.message);
  }
}

/**
 * Helper to find sender bucket.
 */
function getBucketForSender(phone, buckets) {
  if (!buckets) return "casual";
  const normalized = phone.replace(/\D/g, "");

  for (const [bucket, phones] of Object.entries(buckets)) {
    if (Array.isArray(phones)) {
      for (const p of phones) {
        if (p.replace(/\D/g, "") === normalized) return bucket;
      }
    }
  }
  return "casual";
}

// ============================================================
// CALENDAR EVENT EXTRACTION
// ============================================================

/**
 * Extract calendar-worthy events from detected events in a message.
 * Returns Google Calendar "Add to Calendar" links.
 *
 * @param {Array} events — from triage result: [{ description, date }]
 * @param {string} messageText — original message for context
 * @returns {Array} enriched events with calendar links
 */
function extractCalendarEvents(events) {
  if (!events || events.length === 0) return [];

  return events.map((event) => {
    const enriched = {
      description: event.description || "Event detected",
      date_raw: event.date || null,
      date_parsed: null,
      calendar_link: null,
    };

    // Attempt to parse the date
    if (event.date) {
      const parsed = parseFlexibleDate(event.date);
      if (parsed) {
        enriched.date_parsed = parsed.toISOString();
        enriched.calendar_link = buildGoogleCalendarLink(
          event.description,
          parsed
        );
      }
    }

    return enriched;
  });
}

/**
 * Parse flexible date strings from messages.
 * Handles: "tomorrow", "tonight", "next Monday", "March 15", "3pm", etc.
 *
 * @param {string} dateStr
 * @returns {Date|null}
 */
function parseFlexibleDate(dateStr) {
  if (!dateStr) return null;

  const lower = dateStr.toLowerCase().trim();
  const now = new Date();

  // Relative dates
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0); // Default 9 AM
    return d;
  }

  if (lower === "tonight") {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0); // Default 8 PM
    return d;
  }

  if (lower === "today") {
    return now;
  }

  // "next [day]"
  const dayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const targetDay = dayNames.indexOf(dayMatch[1]);
    const d = new Date(now);
    const currentDay = d.getDay();
    let daysAhead = targetDay - currentDay;
    if (daysAhead <= 0) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "in X hours/days"
  const inMatch = lower.match(/in\s+(\d+)\s+(hour|hours|day|days)/);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit.startsWith("hour")) {
      d.setHours(d.getHours() + amount);
    } else {
      d.setDate(d.getDate() + amount);
    }
    return d;
  }

  // Try native Date.parse as last resort
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
    return parsed;
  }

  return null;
}

/**
 * Build a Google Calendar "Add Event" URL.
 *
 * @param {string} title
 * @param {Date} startDate
 * @param {number} durationMinutes — default 60
 * @returns {string} Google Calendar URL
 */
function buildGoogleCalendarLink(title, startDate, durationMinutes = 60) {
  const formatGCal = (date) => {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };

  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${formatGCal(startDate)}/${formatGCal(endDate)}`,
    details: "Event detected by Neuro-Librarian from a WhatsApp message.",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ============================================================
// CRON SCHEDULER
// ============================================================

/**
 * Start the WUPHF cron jobs.
 *
 * @param {Function} emitToUser — SSE emitter from librarian.js
 */
function startWuphfScheduler(emitToUser) {
  // Run nudge check every 30 minutes
  cron.schedule("*/30 * * * *", () => {
    console.log("[WUPHF] Running nudge check...");
    runNudgeCheck(emitToUser);
  });

  console.log("[WUPHF] Nudge scheduler started (every 30 minutes).");
}

module.exports = {
  runNudgeCheck,
  extractCalendarEvents,
  parseFlexibleDate,
  buildGoogleCalendarLink,
  startWuphfScheduler,
};
