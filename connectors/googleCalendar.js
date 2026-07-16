/**
 * connectors/googleCalendar.js — Google Calendar read access
 *
 * Not part of the message pipeline — calendar events aren't
 * "messages," they're context. Exposed via GET /api/calendar/:userId
 * for the UI to show upcoming events. Requires `npm run connect:google`
 * to have been run first (same OAuth credentials as Gmail).
 */

const { getGoogleOAuthClient } = require("./googleAuth");

/**
 * @param {number} maxResults
 * @returns {Promise<Array|null>} null if Google OAuth isn't configured
 */
async function getUpcomingEvents(maxResults = 10) {
  const auth = getGoogleOAuthClient();
  if (!auth) return null;

  const { google } = require("googleapis");
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items || []).map((event) => ({
    id: event.id,
    summary: event.summary || "(no title)",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location || null,
    htmlLink: event.htmlLink,
  }));
}

module.exports = { getUpcomingEvents };
