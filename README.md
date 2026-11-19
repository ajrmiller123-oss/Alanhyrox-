# Alan training feed (Oura)

Feed-only Netlify project. Functions:
- `/.netlify/functions/training-feed?key=FEED_KEY&days=28` returns Oura readiness, sleep, HRV and lowest heart rate as JSON.
- `/.netlify/functions/oura-connect?key=FEED_KEY` is the one-time Oura sign-in; tokens are kept in Netlify Blobs.

Netlify environment variables: `FEED_KEY`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`.
