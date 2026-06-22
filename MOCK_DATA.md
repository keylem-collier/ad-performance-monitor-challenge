# Mock Data Contract

Describes the fixtures in `mock-data/` and how to use them to simulate a flaky external ad platform. Detection must be **derived from the metrics** — nothing here labels which ad is "interesting."

## Fixture files

| File | Description |
|------|-------------|
| `accounts.json` | Two mock ad accounts (`act_mock_1001`, `act_mock_2002`) |
| `campaigns.json` | Campaigns across both accounts (one is paused) |
| `ads.json` | 20 ads linked to campaigns |
| `metrics-daily.json` | 90 days of daily metrics per ad (one row per ad per day) |
| `restatements.json` | A row the platform later corrected (only needed for the optional `asof` mode below) |
| `api-responses/rate_limit.json` | Error envelope for HTTP 429 |
| `api-responses/auth_expired.json` | Error envelope for HTTP 401 |
| `api-responses/timeout.json` | Error envelope for timeout / HTTP 504 |

There are no pre-baked page files — your mock route paginates `metrics-daily.json` itself (see below).

## Entity shapes

### Account (`accounts.json`)
```json
{ "id": "act_mock_1001", "name": "Acme Outdoor Co. — Mock Ad Account",
  "platform": "mock_meta", "currency": "USD", "timezone": "America/New_York", "status": "active" }
```

### Campaign
```json
{ "id": "camp_100", "account_id": "act_mock_1001", "name": "Spring Sale — Prospecting",
  "status": "active", "objective": "conversions" }
```

### Ad
```json
{ "id": "ad_a", "campaign_id": "camp_100", "account_id": "act_mock_1001",
  "name": "Hero Video — Trail Runner v1", "status": "active", "creative_type": "video" }
```

### Daily metric row
```json
{ "date": "2026-06-16", "ad_id": "ad_a", "campaign_id": "camp_100", "account_id": "act_mock_1001",
  "impressions": 44900, "clicks": 404, "spend": 107.0, "conversions": 9, "ctr": 0.009, "frequency": 3.5 }
```

> `ctr` is `null` on any day with zero impressions (a click-through rate is undefined when nothing was served). Real platforms behave this way — handle it.

## Date range

Metrics span **2026-03-19 → 2026-06-16** (90 days inclusive).

## What's in the data

The dataset reflects real platform messiness across both accounts. Without naming ads: some creatives **fatigue** (CTR declines as frequency rises), some show a **spend anomaly** (spend climbs while results don't keep up), some have **sparse, gappy, or zero-impression** stretches, some have **too little history** to judge, and some are **stable**. Volume varies a lot day to day. Derive your signals from the numbers; don't hardcode to ad IDs.

### Suggested fatigue rule (you may vary it)

Flag when **CTR over the last 7 days** is ≥15% below the **prior 7 days** AND **average frequency** rose by ≥0.5. How you compute "CTR over a window" is your call — and it matters.

A reasonable second rule: **spend up sharply while conversions don't keep pace.**

## Mock API

Implement a server-side route (suggested: `GET /api/mock-platform/metrics`) that reads the fixtures and simulates the platform.

### Pagination

Filter by `account_id`, then page the result (page size 100):
```json
{ "page": 1, "page_size": 100, "total_pages": 10, "total_rows": 990,
  "account_id": "act_mock_1001", "data": [ /* metric rows */ ] }
```
Fetch **all pages** before marking sync complete.

| Param | Description |
|-------|-------------|
| `account_id` | Required. `act_mock_1001` or `act_mock_2002` |
| `page` | 1-based. Default `1` |

### Failure simulation (`fail` query param)

Reviewers will exercise these.

| `fail` | HTTP | Behavior | You should |
|--------|------|----------|------------|
| *(none)* | 200 | Paginated success | Complete when all pages succeed |
| `rate_limit` | 429 | `rate_limit.json` | Treat as retryable; status reflects failure/partial |
| `page2` | 200 then error | Page 1 ok; page ≥2 errors (500) | Honest **partial** state — don't report full success, and don't draw conclusions from half the data |
| `auth` | 401 | `auth_expired.json` | Terminal; clear operator message |
| `timeout` | 504 | `timeout.json` | Treat as retryable |

```
GET /api/mock-platform/metrics?account_id=act_mock_1001&page=1
GET /api/mock-platform/metrics?account_id=act_mock_1001&page=1&fail=page2
```
Document in your README how to trigger each mode.

## Idempotency

Daily metrics are unique on `(account_id, ad_id, date)`. Upsert on that key so a second sync doesn't duplicate or double-count.

## Optional / bonus (not required for the core — good signal if you get to it)

These mirror real platform pain. Skip them if you're tight on time; they make good follow-ups.

- **Incremental / historical sync (`asof`)** — support an `asof=YYYY-MM-DD` param that returns data **as it stood on that date** (rows up to `asof`). Lets sync run against a moving "today" instead of only the final snapshot.
- **Restatements** — `restatements.json` lists a `(ad_id, date)` the platform first reported high, then corrected. When `asof` is before `corrected_on_asof`, serve the `preliminary` value; otherwise serve the `metrics-daily.json` value. A robust pipeline upserts by value (the correction wins) and re-derives detection.
- **Alerts that reflect current state** — when an ad's problem clears, its task should resolve itself rather than linger.

## Regenerating fixtures (maintainers only)

```bash
node scripts/generate-metrics.mjs
```
Overwrites the files in `mock-data/`.
</content>
