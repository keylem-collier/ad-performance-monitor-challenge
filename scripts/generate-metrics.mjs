#!/usr/bin/env node
/**
 * Generates the mock ad-platform dataset (v2).
 *   node scripts/generate-metrics.mjs
 *
 * Outputs (candidate-facing, committed to this repo):
 *   mock-data/accounts.json          two ad accounts
 *   mock-data/campaigns.json         campaigns across both accounts
 *   mock-data/ads.json               20 ads
 *   mock-data/metrics-daily.json     90 days of daily metrics (FINAL values)
 *   mock-data/restatements.json      rows the platform later corrected
 *   mock-data/api-responses/*.json   error envelopes
 *
 * The data reflects real platform messiness — varying volume, gaps, a
 * zero-impression day, ads whose performance shifts over time, a day the
 * platform later corrects. Detection should be derived from the numbers.
 *
 * Pagination and `?asof=` are computed by the candidate's mock route from
 * metrics-daily.json + restatements.json (see MOCK_DATA.md) — not pre-baked,
 * so the route has to do real work.
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const mockDir = join(root, "mock-data");
const apiDir = join(mockDir, "api-responses");

const START = new Date("2026-03-19T00:00:00Z"); // day 0
const DAYS = 90; // day 89 = 2026-06-16

const dateStr = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
const r2 = (n) => +n.toFixed(2);
const clicksFrom = (impressions, ctr) => Math.round(impressions * ctr);

// ---------------------------------------------------------------------------
// Accounts / campaigns / ads
// ---------------------------------------------------------------------------
const accounts = [
  { id: "act_mock_1001", name: "Acme Outdoor Co. — Mock Ad Account", platform: "mock_meta", currency: "USD", timezone: "America/New_York", status: "active" },
  { id: "act_mock_2002", name: "Northwind Coffee Co. — Mock Ad Account", platform: "mock_meta", currency: "USD", timezone: "America/Los_Angeles", status: "active" },
];

const campaigns = [
  { id: "camp_100", account_id: "act_mock_1001", name: "Spring Sale — Prospecting", status: "active", objective: "conversions" },
  { id: "camp_110", account_id: "act_mock_1001", name: "Trail Gear — Retargeting", status: "active", objective: "conversions" },
  { id: "camp_120", account_id: "act_mock_1001", name: "Brand — Always On", status: "active", objective: "traffic" },
  { id: "camp_130", account_id: "act_mock_1001", name: "Clearance — Paused", status: "paused", objective: "conversions" },
  { id: "camp_200", account_id: "act_mock_2002", name: "Cold Brew Launch", status: "active", objective: "conversions" },
  { id: "camp_210", account_id: "act_mock_2002", name: "Subscriptions — Prospecting", status: "active", objective: "conversions" },
];

// Each ad: id, campaign, account, name, creative_type, and a daily profile.
// profile(dayIndex) -> daily metrics or null (no row that day).
const ads = [
  // --- Account 1: act_mock_1001 -------------------------------------------
  // Clean creative-fatigue positive: CTR falls, frequency rises, uniform volume.
  // Prior window (d76-82) healthy; last window (d83-89) fatigued.
  { id: "ad_a", campaign_id: "camp_100", account_id: "act_mock_1001", name: "Hero Video — Trail Runner v1", creative_type: "video",
    profile: (d) => {
      const fatigued = d >= 83;
      const impressions = 40000 + d * 60;
      const ctr = fatigued ? 0.0085 - (d - 83) * 0.0003 : 0.0118;
      const freq = fatigued ? 2.7 + (d - 83) * 0.1 : 1.9 + d * 0.004;
      return { impressions, clicks: clicksFrom(impressions, ctr), spend: r2(80 + d * 1.4), conversions: 12 + (d % 4), frequency: r2(freq) };
    } },

  // Lumpy daily volume: most days run ~60k impressions, with a couple of very
  // low-volume days mixed in. Frequency drifts up over the last week.
  { id: "ad_mf", campaign_id: "camp_100", account_id: "act_mock_1001", name: "Carousel — Summit Pack", creative_type: "carousel",
    profile: (d) => {
      const freq = d >= 83 ? 2.9 + (d - 83) * 0.05 : 2.0 + d * 0.004;
      let impressions, ctr;
      if (d >= 83) {
        const tiny = d === 85 || d === 88; // two low-volume, low-CTR days
        impressions = tiny ? 500 : 60000;
        ctr = tiny ? 0.002 : 0.012;
      } else {
        impressions = 40000;
        ctr = 0.012;
      }
      return { impressions, clicks: clicksFrom(impressions, ctr), spend: r2(70 + d * 0.9), conversions: 9 + (d % 3), frequency: r2(freq) };
    } },

  // Has a delivery-outage day with zero impressions (CTR undefined -> null)
  // inside the recent window.
  { id: "ad_zero", campaign_id: "camp_110", account_id: "act_mock_1001", name: "Static — Tent Closeout", creative_type: "image",
    profile: (d) => {
      if (d === 86) return { impressions: 0, clicks: 0, spend: 0, conversions: 0, frequency: 0 }; // delivery outage
      const impressions = 18000 + d * 30;
      return { impressions, clicks: clicksFrom(impressions, 0.0095), spend: r2(40 + d * 0.6), conversions: 5 + (d % 2), frequency: r2(1.7 + (d % 7) * 0.03) };
    } },

  // Spend-spike positive: spend climbs, conversions flat.
  { id: "ad_spike", campaign_id: "camp_110", account_id: "act_mock_1001", name: "Video — Kayak Bundle", creative_type: "video",
    profile: (d) => {
      const recent = d >= 83;
      const impressions = recent ? 56000 + d * 150 : 32000 + d * 90;
      return { impressions, clicks: clicksFrom(impressions, 0.008), spend: r2(recent ? 150 + (d - 83) * 6 : 80 + d * 0.3), conversions: 6 + (d % 2), frequency: r2(recent ? 2.5 : 2.0) };
    } },

  // Spend climbs over the last week while conversions fall.
  { id: "ad_crash", campaign_id: "camp_110", account_id: "act_mock_1001", name: "Carousel — Cooler Sale", creative_type: "carousel",
    profile: (d) => {
      const recent = d >= 83;
      const impressions = recent ? 50000 + d * 120 : 34000 + d * 80;
      return { impressions, clicks: clicksFrom(impressions, 0.0075), spend: r2(recent ? 165 + (d - 83) * 7 : 100 + d * 0.3), conversions: recent ? 3 : 7, frequency: r2(recent ? 2.6 : 2.1) };
    } },

  // Smooth baseline. One recent day's spend is later corrected by the platform
  // (see restatements.json) — the route serves the preliminary value until then.
  { id: "ad_restate", campaign_id: "camp_100", account_id: "act_mock_1001", name: "Video — Headlamp Promo", creative_type: "video",
    profile: (d) => {
      const impressions = 30000 + d * 70;
      return { impressions, clicks: clicksFrom(impressions, 0.009), spend: r2(90 + d * 1.0), conversions: 7 + (d % 2), frequency: r2(2.0 + (d % 5) * 0.04) };
    } },

  // CTR dipped and frequency rose for a stretch, then returned to healthy over
  // the final days.
  { id: "ad_recover", campaign_id: "camp_100", account_id: "act_mock_1001", name: "Hero Image — Backpack v2", creative_type: "image",
    profile: (d) => {
      let ctr, freq;
      if (d >= 84) { ctr = 0.0125; freq = 2.1; }          // recovered (last days)
      else if (d >= 77) { ctr = 0.0080; freq = 3.0 + (d - 77) * 0.05; } // fatigued
      else { ctr = 0.0125; freq = 2.0; }                   // healthy
      const impressions = 36000 + d * 50;
      return { impressions, clicks: clicksFrom(impressions, ctr), spend: r2(70 + d * 1.1), conversions: 10 + (d % 3), frequency: r2(freq) };
    } },

  // CTR falls and frequency rises over the last week, with two missing days in
  // that window (no rows reported).
  { id: "ad_gap", campaign_id: "camp_120", account_id: "act_mock_1001", name: "Static — Trail Map Lead", creative_type: "image",
    profile: (d) => {
      if (d === 84 || d === 85) return null; // missing days inside last 7d window
      const fatigued = d >= 83;
      const impressions = 16000 + d * 25;
      const ctr = fatigued ? 0.0072 : 0.0102;
      const freq = fatigued ? 2.7 + (d - 83) * 0.12 : 2.0;
      return { impressions, clicks: clicksFrom(impressions, ctr), spend: r2(35 + d * 0.5), conversions: 4 + (d % 2), frequency: r2(freq) };
    } },

  // INSUFFICIENT baseline: only the last 2 days.
  { id: "ad_insufficient", campaign_id: "camp_120", account_id: "act_mock_1001", name: "Video — New Launch Teaser", creative_type: "video",
    profile: (d) => (d < 88 ? null : { impressions: 9000, clicks: 108, spend: 24, conversions: 2, frequency: 1.2 }) },

  // Stable controls (no flags).
  { id: "ad_b", campaign_id: "camp_120", account_id: "act_mock_1001", name: "Static — Evergreen Brand", creative_type: "image",
    profile: (d) => { const impressions = 22000 + d * 40; return { impressions, clicks: clicksFrom(impressions, 0.011 + (d % 5) * 0.0001), spend: r2(45 + d * 0.7), conversions: 10 + (d % 3), frequency: r2(1.8 + (d % 7) * 0.04) }; } },
  { id: "ad_f", campaign_id: "camp_130", account_id: "act_mock_1001", name: "Static — Clearance (Paused)", creative_type: "image",
    profile: (d) => { const impressions = 12000 + d * 20; return { impressions, clicks: clicksFrom(impressions, 0.006), spend: r2(26 + d * 0.3), conversions: 3, frequency: 1.3 }; } },
  { id: "ad_lowvol", campaign_id: "camp_120", account_id: "act_mock_1001", name: "Static — Niche Audience", creative_type: "image",
    profile: (d) => { const impressions = 1400 + (d % 9) * 60; return { impressions, clicks: clicksFrom(impressions, 0.009 + (d % 4) * 0.0005), spend: r2(6 + (d % 5) * 0.4), conversions: d % 3, frequency: r2(1.2 + (d % 5) * 0.02) }; } },

  // --- Account 2: act_mock_2002 -------------------------------------------
  // A fatigue positive so the second tenant has a real flag of its own.
  { id: "ad_g", campaign_id: "camp_200", account_id: "act_mock_2002", name: "Video — Cold Brew Hero", creative_type: "video",
    profile: (d) => { const fatigued = d >= 83; const impressions = 28000 + d * 45; const ctr = fatigued ? 0.0079 : 0.0110; const freq = fatigued ? 2.7 + (d - 83) * 0.12 : 2.0; return { impressions, clicks: clicksFrom(impressions, ctr), spend: r2(60 + d * 0.9), conversions: 8 + (d % 3), frequency: r2(freq) }; } },
  { id: "ad_h", campaign_id: "camp_200", account_id: "act_mock_2002", name: "Static — Bag Subscription", creative_type: "image",
    profile: (d) => { const impressions = 20000 + d * 35; return { impressions, clicks: clicksFrom(impressions, 0.0105), spend: r2(40 + d * 0.6), conversions: 9 + (d % 2), frequency: r2(1.7 + (d % 6) * 0.03) }; } },
  // Spend-spike positive for account 2.
  { id: "ad_i", campaign_id: "camp_210", account_id: "act_mock_2002", name: "Carousel — Sampler Pack", creative_type: "carousel",
    profile: (d) => { const recent = d >= 83; const impressions = recent ? 48000 + d * 120 : 30000 + d * 80; return { impressions, clicks: clicksFrom(impressions, 0.0082), spend: r2(recent ? 140 + (d - 83) * 8 : 80 + d * 0.3), conversions: 5 + (d % 2), frequency: r2(recent ? 2.4 : 2.0) }; } },
  { id: "ad_j", campaign_id: "camp_210", account_id: "act_mock_2002", name: "Video — Origin Story", creative_type: "video",
    profile: (d) => { const impressions = 17000 + d * 30; return { impressions, clicks: clicksFrom(impressions, 0.0098), spend: r2(38 + d * 0.5), conversions: 6 + (d % 2), frequency: r2(1.6 + (d % 7) * 0.03) }; } },
  { id: "ad_k", campaign_id: "camp_200", account_id: "act_mock_2002", name: "Static — Gift Set", creative_type: "image",
    profile: (d) => { const impressions = 14000 + d * 25; return { impressions, clicks: clicksFrom(impressions, 0.0089), spend: r2(30 + d * 0.45), conversions: 4 + (d % 2), frequency: r2(1.5) }; } },
  { id: "ad_l", campaign_id: "camp_210", account_id: "act_mock_2002", name: "Static — Retarget Mug", creative_type: "image",
    profile: (d) => { const impressions = 11000 + d * 18; return { impressions, clicks: clicksFrom(impressions, 0.0076), spend: r2(24 + d * 0.35), conversions: 3, frequency: 1.3 }; } },
  { id: "ad_m", campaign_id: "camp_200", account_id: "act_mock_2002", name: "Video — Tasting Notes", creative_type: "video",
    profile: (d) => { const impressions = 19000 + d * 32; return { impressions, clicks: clicksFrom(impressions, 0.0101), spend: r2(42 + d * 0.55), conversions: 7 + (d % 2), frequency: r2(1.7 + (d % 6) * 0.03) }; } },
  { id: "ad_n", campaign_id: "camp_210", account_id: "act_mock_2002", name: "Static — Holiday Bundle", creative_type: "image",
    profile: (d) => { const impressions = 13000 + d * 22; return { impressions, clicks: clicksFrom(impressions, 0.0084), spend: r2(28 + d * 0.4), conversions: 4 + (d % 2), frequency: r2(1.5) }; } },
];

// ---------------------------------------------------------------------------
// Build rows
// ---------------------------------------------------------------------------
const rows = [];
for (let d = 0; d < DAYS; d++) {
  const date = dateStr(addDays(START, d));
  for (const ad of ads) {
    const m = ad.profile(d);
    if (!m) continue;
    // A zero-impression day has an undefined CTR — the platform returns null,
    // not 0. Aggregation has to cope with that rather than divide 0/0.
    const ctr = m.impressions > 0 ? +(m.clicks / m.impressions).toFixed(6) : null;
    rows.push({
      date,
      ad_id: ad.id,
      campaign_id: ad.campaign_id,
      account_id: ad.account_id,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.spend,
      conversions: m.conversions,
      ctr,
      frequency: m.frequency,
    });
  }
}

// Order ad-major (then by date): pages deliberately are NOT globally
// chronological, and an ad's days span multiple pages. A pipeline that assumes
// "page 1 is the oldest data" or sorted input will anchor windows wrong.
rows.sort((a, b) => a.account_id.localeCompare(b.account_id) || a.ad_id.localeCompare(b.ad_id) || a.date.localeCompare(b.date));

// Restatement: ad_restate, one recent day, over-reported then corrected.
const RESTATE_DATE = dateStr(addDays(START, 86));
const RESTATE_CORRECTED_ASOF = dateStr(addDays(START, 89));
const finalRow = rows.find((r) => r.ad_id === "ad_restate" && r.date === RESTATE_DATE);
const restatements = [
  {
    account_id: "act_mock_1001",
    ad_id: "ad_restate",
    date: RESTATE_DATE,
    // The platform served this inflated value until it reconciled on this asof:
    preliminary: { spend: r2(finalRow.spend * 5), conversions: finalRow.conversions },
    corrected_on_asof: RESTATE_CORRECTED_ASOF,
    note: "Spend over-reported, then corrected. Serve `preliminary` when asof < corrected_on_asof; serve the metrics-daily value otherwise.",
  },
];

mkdirSync(apiDir, { recursive: true });
writeFileSync(join(mockDir, "accounts.json"), `${JSON.stringify(accounts, null, 2)}\n`);
writeFileSync(join(mockDir, "campaigns.json"), `${JSON.stringify(campaigns, null, 2)}\n`);
writeFileSync(join(mockDir, "ads.json"), `${JSON.stringify(ads.map(({ profile, ...a }) => a), null, 2)}\n`);
writeFileSync(join(mockDir, "metrics-daily.json"), `${JSON.stringify(rows, null, 2)}\n`);
writeFileSync(join(mockDir, "restatements.json"), `${JSON.stringify(restatements, null, 2)}\n`);

const err = (obj) => `${JSON.stringify({ error: obj }, null, 2)}\n`;
writeFileSync(join(apiDir, "rate_limit.json"), err({ code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Retry after 60 seconds.", retry_after_seconds: 60 }));
writeFileSync(join(apiDir, "auth_expired.json"), err({ code: "AUTH_TOKEN_EXPIRED", message: "Access token has expired. Reconnect the ad account." }));
writeFileSync(join(apiDir, "timeout.json"), err({ code: "GATEWAY_TIMEOUT", message: "Upstream platform did not respond within 30 seconds.", retryable: true }));

// ---------------------------------------------------------------------------
// Structural sanity (printed, not written).
// ---------------------------------------------------------------------------
const byAcct = (id) => rows.filter((r) => r.account_id === id).length;
const dates = rows.map((r) => r.date).sort();
console.log(`Generated ${rows.length} rows · ${ads.length} ads · ${accounts.length} accounts · ${DAYS} days`);
console.log(`Date range: ${dates[0]} … ${dates[dates.length - 1]}`);
console.log(`Rows per account: ${accounts.map((a) => `${a.id}=${byAcct(a.id)}`).join(", ")}`);
console.log(`Pages @ size 100: ${Math.ceil(rows.length / 100)} · null-CTR rows: ${rows.filter((r) => r.ctr == null).length} · restatements: ${restatements.length}`);
console.log("OK — fixtures written to mock-data/.");
