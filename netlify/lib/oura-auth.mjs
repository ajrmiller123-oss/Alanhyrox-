// Oura OAuth helper for the private training feed.
// Tokens live in Netlify Blobs (store "oura-auth", key "tokens"), never in code.
// Needs these Netlify environment variables:
//   FEED_KEY            long random string; guards the feed and the connect page
//   OURA_CLIENT_ID      from your Oura API application (cloud.ouraring.com/oauth/applications)
//   OURA_CLIENT_SECRET  from the same application
// Optional fallback: OURA_PAT (an old Oura personal access token, if Oura still honours it).

import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const SCOPES = "personal daily heartrate workout session";

const store = () => getStore("oura-auth");

export function redirectUri(req) {
  return new URL("/.netlify/functions/oura-connect", req.url).toString();
}

export function expectedState() {
  return createHash("sha256").update(`oura-connect:${process.env.FEED_KEY}`).digest("hex").slice(0, 32);
}

export function authorizeUrl(req) {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.OURA_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri(req));
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", expectedState());
  return u.toString();
}

async function tokenRequest(params) {
  const body = new URLSearchParams({
    ...params,
    client_id: process.env.OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const why = json.error_description || json.error || json.detail || "no access token returned";
    throw new Error(`Oura token request failed (HTTP ${res.status}): ${why}`);
  }
  return json;
}

async function saveTokens(t, previous = {}) {
  const record = {
    access_token: t.access_token,
    // Oura refresh tokens are single use; keep the old one only if no new one came back.
    refresh_token: t.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (Number(t.expires_in) || 86400) * 1000,
    saved_at: new Date().toISOString(),
  };
  await store().setJSON("tokens", record);
  return record;
}

export async function exchangeCode(code, req) {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(req),
  });
  return saveTokens(t);
}

export async function getAccessToken() {
  const rec = await store().get("tokens", { type: "json" });
  if (rec && rec.access_token) {
    if (rec.expires_at - Date.now() > 10 * 60 * 1000) {
      return { token: rec.access_token, source: "oauth" };
    }
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: rec.refresh_token });
    const saved = await saveTokens(t, rec);
    return { token: saved.access_token, source: "oauth" };
  }
  if (process.env.OURA_PAT) return { token: process.env.OURA_PAT, source: "legacy-token" };
  throw new Error("Oura is not connected yet. Open /.netlify/functions/oura-connect?key=<FEED_KEY> once to connect it.");
}
