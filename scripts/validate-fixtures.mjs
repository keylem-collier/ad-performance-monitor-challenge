#!/usr/bin/env node
/**
 * Structural sanity check for the mock fixtures — shapes, references, and
 * pagination math. Does not assert detection outcomes (those are for you to
 * derive). Run: node scripts/validate-fixtures.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const mockDir = join(dirname(fileURLToPath(import.meta.url)), "..", "mock-data");
const load = (f) => JSON.parse(readFileSync(join(mockDir, f), "utf8"));

const accounts = load("accounts.json");
const campaigns = load("campaigns.json");
const ads = load("ads.json");
const metrics = load("metrics-daily.json");
const restatements = load("restatements.json");

const errors = [];
const warn = [];
const accountIds = new Set(accounts.map((a) => a.id));
const campaignIds = new Set(campaigns.map((c) => c.id));
const adIds = new Set(ads.map((a) => a.id));

// Referential integrity
for (const c of campaigns) if (!accountIds.has(c.account_id)) errors.push(`campaign ${c.id} → unknown account ${c.account_id}`);
for (const a of ads) {
  if (!accountIds.has(a.account_id)) errors.push(`ad ${a.id} → unknown account ${a.account_id}`);
  if (!campaignIds.has(a.campaign_id)) errors.push(`ad ${a.id} → unknown campaign ${a.campaign_id}`);
}

// Metric rows: shape, references, ctr/null rule, no duplicates
const required = ["date", "ad_id", "campaign_id", "account_id", "impressions", "clicks", "spend", "conversions", "ctr", "frequency"];
const seen = new Set();
for (const r of metrics) {
  for (const k of required) if (!(k in r)) errors.push(`row ${r.ad_id} ${r.date} missing ${k}`);
  if (!adIds.has(r.ad_id)) errors.push(`metric row → unknown ad ${r.ad_id}`);
  if (r.impressions === 0 && r.ctr !== null) warn.push(`${r.ad_id} ${r.date}: zero impressions but ctr is ${r.ctr} (expected null)`);
  if (r.impressions > 0 && r.ctr === null) warn.push(`${r.ad_id} ${r.date}: ctr null but impressions > 0`);
  const key = `${r.account_id}|${r.ad_id}|${r.date}`;
  if (seen.has(key)) errors.push(`duplicate row ${key}`);
  seen.add(key);
}

// Restatements reference real rows
for (const rs of restatements) {
  const exists = metrics.some((r) => r.account_id === rs.account_id && r.ad_id === rs.ad_id && r.date === rs.date);
  if (!exists) errors.push(`restatement ${rs.ad_id} ${rs.date} has no matching metric row`);
  if (rs.preliminary == null || !rs.corrected_on_asof) errors.push(`restatement ${rs.ad_id} ${rs.date} missing preliminary/corrected_on_asof`);
}

// Per-account pagination math (page size 100)
const dates = metrics.map((r) => r.date).sort();
console.log("=== Fixture validation ===\n");
console.log(`accounts: ${accounts.length} · campaigns: ${campaigns.length} · ads: ${ads.length}`);
console.log(`metric rows: ${metrics.length} · range ${dates[0]} … ${dates[dates.length - 1]}`);
for (const acc of accounts) {
  const n = metrics.filter((r) => r.account_id === acc.id).length;
  console.log(`  ${acc.id}: ${n} rows → ${Math.ceil(n / 100)} pages @ size 100`);
}
console.log(`null-ctr rows: ${metrics.filter((r) => r.ctr === null).length} · restatements: ${restatements.length}\n`);

for (const file of ["rate_limit.json", "auth_expired.json", "timeout.json"]) {
  const body = load(join("api-responses", file));
  if (!body.error?.code) errors.push(`${file} missing error.code`);
}

if (warn.length) { console.log("Warnings:"); warn.slice(0, 10).forEach((w) => console.log("  ⚠", w)); if (warn.length > 10) console.log(`  … +${warn.length - 10} more`); console.log(""); }
if (errors.length) { console.log("Errors:"); errors.forEach((e) => console.log("  ✗", e)); process.exit(1); }
console.log("✓ Structure looks good. Ready for candidate use.");
