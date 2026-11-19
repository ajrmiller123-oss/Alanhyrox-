// Private training feed: Oura readiness, sleep and HRV as compact JSON.
// GET /.netlify/functions/training-feed?key=<FEED_KEY>&days=14
// Read by the daily and weekly training-plan runs. Returns 403 without the key.

import { getAccessToken } from "../lib/oura-auth.mjs";

const API = "https://api.ouraring.com/v2/usercollection";

const json = (status, body) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const londonDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const avg = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.FEED_KEY || url.searchParams.get("key") !== process.env.FEED_KEY) {
    return json(403, { ok: false, error: "forbidden" });
  }

  const days = Math.min(Math.max(parseInt(url.searchParams.get("days"), 10) || 14, 1), 60);
  const today = londonDate();
  const start = addDays(today, -(days - 1));
  const end = addDays(today, 1);

  let auth;
  try {
    auth = await getAccessToken();
  } catch (e) {
    return json(503, { ok: false, error: e.message, today });
  }

  const errors = [];
  const get = async (path) => {
    const r = await fetch(`${API}/${path}?start_date=${start}&end_date=${end}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!r.ok) {
      errors.push(`${path}: HTTP ${r.status}`);
      return [];
    }
    return (await r.json()).data || [];
  };

  const [readiness, dailySleep, sleep, activity] = await Promise.all([
    get("daily_readiness"),
    get("daily_sleep"),
    get("sleep"),
    get("daily_activity"),
  ]);

  if (errors.length && !readiness.length && !dailySleep.length) {
    const authProblem = errors.some((e) => /HTTP 401|HTTP 403/.test(e));
    return json(502, {
      ok: false,
      error: authProblem ? "Oura refused the token. Reconnect via /.netlify/functions/oura-connect?key=<FEED_KEY>." : "Oura API error",
      details: errors,
      source: auth.source,
      today,
    });
  }

  const byDay = {};
  const row = (day) => (byDay[day] ||= { date: day });

  for (const r of readiness) {
    const x = row(r.day);
    x.readiness = r.score ?? null;
    x.temp_deviation_c = r.temperature_deviation ?? null;
    const c = r.contributors || {};
    x.readiness_contributors = {
      hrv_balance: c.hrv_balance ?? null,
      resting_heart_rate: c.resting_heart_rate ?? null,
      recovery_index: c.recovery_index ?? null,
      previous_night: c.previous_night ?? null,
      sleep_balance: c.sleep_balance ?? null,
      previous_day_activity: c.previous_day_activity ?? null,
      activity_balance: c.activity_balance ?? null,
      body_temperature: c.body_temperature ?? null,
    };
  }
  for (const s of dailySleep) row(s.day).sleep_score = s.score ?? null;

  // Main overnight sleep per day = the longest sleep period ending that day.
  const mainSleep = {};
  for (const s of sleep) {
    if (s.type && !["long_sleep", "sleep"].includes(s.type)) continue;
    const prev = mainSleep[s.day];
    if (!prev || (s.total_sleep_duration || 0) > (prev.total_sleep_duration || 0)) mainSleep[s.day] = s;
  }
  for (const [day, s] of Object.entries(mainSleep)) {
    const x = row(day);
    x.sleep_hours = s.total_sleep_duration ? Math.round((s.total_sleep_duration / 3600) * 10) / 10 : null;
    x.sleep_efficiency = s.efficiency ?? null;
    x.avg_hrv_ms = s.average_hrv ?? null;
    x.lowest_hr_bpm = s.lowest_heart_rate ?? null;
    x.avg_hr_bpm = s.average_heart_rate ?? null;
    x.bedtime_start = s.bedtime_start ?? null;
    x.bedtime_end = s.bedtime_end ?? null;
  }
  for (const a of activity) {
    const x = row(a.day);
    x.activity_score = a.score ?? null;
    x.steps = a.steps ?? null;
    x.active_kcal = a.active_calories ?? null;
  }

  const list = Object.values(byDay).sort((a, b) => (a.date < b.date ? 1 : -1));
  const prior = list.filter((d) => d.date !== today);
  const baseline = {
    days: prior.length,
    readiness: avg(prior.map((d) => d.readiness)),
    sleep_score: avg(prior.map((d) => d.sleep_score)),
    avg_hrv_ms: avg(prior.map((d) => d.avg_hrv_ms)),
    lowest_hr_bpm: avg(prior.map((d) => d.lowest_hr_bpm)),
    sleep_hours: avg(prior.map((d) => d.sleep_hours)),
  };
  const t = byDay[today] || null;
  const latestReadinessDay = list.find((d) => typeof d.readiness === "number")?.date || null;

  const summary = t && typeof t.readiness === "number"
    ? `Today ${today}: readiness ${t.readiness} (baseline ${baseline.readiness}), sleep score ${t.sleep_score ?? "n/a"}, ` +
      `HRV ${t.avg_hrv_ms ?? "n/a"} ms (baseline ${baseline.avg_hrv_ms}), lowest HR ${t.lowest_hr_bpm ?? "n/a"} bpm (baseline ${baseline.lowest_hr_bpm}), ` +
      `sleep ${t.sleep_hours ?? "n/a"} h.`
    : `No readiness for ${today} yet (latest is ${latestReadinessDay || "none"}). Open the Oura app to sync.`;

  return json(200, {
    ok: true,
    source: auth.source,
    generated_at: new Date().toISOString(),
    timezone: "Europe/London",
    today,
    today_synced: Boolean(t && typeof t.readiness === "number"),
    latest_readiness_day: latestReadinessDay,
    summary,
    baseline_prior_days: baseline,
    days: list,
    errors,
  });
};
