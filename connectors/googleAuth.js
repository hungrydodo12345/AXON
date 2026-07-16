/**
 * connectors/googleAuth.js — Shared Google OAuth2 client
 *
 * Builds an authenticated OAuth2 client from the credentials produced
 * by `npm run connect:google` (see scripts/connect-google.js). Used by
 * both the Gmail connector and the Calendar endpoint.
 */

function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const { google } = require("googleapis");
  const client = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

module.exports = { getGoogleOAuthClient };
