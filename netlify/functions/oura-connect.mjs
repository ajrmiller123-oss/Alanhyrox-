// One-time Oura connection page.
// 1. Open https://alanhyrox.netlify.app/.netlify/functions/oura-connect?key=<FEED_KEY>
// 2. Approve on Oura's page; Oura sends you back here and the tokens are saved.
// Register this exact redirect URI in your Oura API application:
//   https://alanhyrox.netlify.app/.netlify/functions/oura-connect

import { authorizeUrl, exchangeCode, expectedState } from "../lib/oura-auth.mjs";

const page = (status, title, message) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

export default async (req) => {
  const url = new URL(req.url);
  const { FEED_KEY, OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;

  if (!FEED_KEY || !OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
    return page(500, "Not set up yet", "Add FEED_KEY, OURA_CLIENT_ID and OURA_CLIENT_SECRET in Netlify's environment variables, redeploy, then try again.");
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) return page(400, "Oura did not connect", `Oura replied: ${oauthError}. Try again.`);

  const code = url.searchParams.get("code");
  if (!code) {
    if (url.searchParams.get("key") !== FEED_KEY) return page(403, "Not allowed", "This link needs the feed key.");
    return Response.redirect(authorizeUrl(req), 302);
  }

  if (url.searchParams.get("state") !== expectedState()) {
    return page(403, "Not allowed", "The sign-in link did not match. Start again from the connect link.");
  }

  try {
    await exchangeCode(code, req);
    return page(200, "Oura connected", "Your training feed can now read readiness, sleep and HRV. You can close this page.");
  } catch (e) {
    return page(502, "Oura did not connect", e.message);
  }
};
