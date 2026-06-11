# Real Facebook Marketplace Scraping — Design (2026-06-11)

## Goal
Replace the "Mock FB Listings" Code node in Workflow 1 (Scout & Approve, id `4wQ1tGJd9GSfppoc`)
with the real Apify Facebook Marketplace scraper, so the daily 8:00 run scores real listings.

## Decisions (approved by Shaun 2026-06-11)
- **Search**: `dětské oblečení` (kids' clothing), Prague, Czech Republic, 0–500 CZK, max 50 items/day.
- **Wait strategy**: Option A — start the Apify run, then poll in a Wait→Check→IF loop until the
  run reports SUCCEEDED, then fetch dataset items. (The sync endpoint risks a silent timeout on
  slow mornings; this runs unattended, so robustness wins.)
- **Dedup**: skip listings whose FB ID already exists in the Google Sheet `Items` tab
  (column `FB ID`). Only new listings reach Claude scoring / Telegram.
- Everything downstream of the listings source (Claude scoring, threshold 7, Telegram approval
  cards, Sheets appends) is verified working and stays untouched.

## New node chain (replaces "Mock FB Listings")
1. `Start Apify Run` — HTTP POST `https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs?token={{ $env.APIFY_API_KEY }}`
2. `Wait 60s` — n8n Wait node
3. `Check Run Status` — HTTP GET `/v2/actor-runs/{id}`
4. `Run Finished?` — IF node (`n8n-nodes-base.if` v2, never Switch); false → loop back to Wait,
   true → continue. Also fail loudly if status is FAILED/ABORTED/TIMED-OUT.
5. `Get Listings` — HTTP GET `/v2/actor-runs/{id}/dataset/items`
6. `Normalize Listings` — Code node mapping actor output to the canonical shape the rest of the
   workflow expects: `{ id, title, price, description, url, images[], sellerName }`.
   Exact field mapping determined from a real test run before wiring (actor schema not documented).
7. `Get Known FB IDs` — Google Sheets read (executeOnce, alwaysOutputData) of column `FB ID`
8. `Filter New Items` — Code node: drop listings whose id is already in the sheet
9. → existing `Loop Through Items` (SplitInBatches; exit on **loop** output, bottom)

## Constraints / gotchas
- Apply changes via the n8n public API (PUT `/api/v1/workflows/4wQ1tGJd9GSfppoc`); Shaun must
  refresh any open editor tab WITHOUT saving afterwards.
- Apify free plan: $5/month credit (cycle resets Jul 7); verify real cost after first run via
  `/v2/users/me/limits`.
- Real FB image URLs may expire over time; Telegram fetches at send time so acceptable. No
  preemptive fallback (YAGNI).
- Repo JSON re-exported from live after verification, sheet ID scrubbed to `YOUR_GOOGLE_SHEET_ID`.
- Git push auto-deploys Railway (n8n restarts ~1–2 min) — push once, at the end, with warning.

## Testing
- One small real actor run (maxItems ~3–5) via curl to learn the output schema (costs cents).
- End-to-end test of the edited workflow via a temporary webhook trigger added through the API
  (schedule triggers can't be fired via API), then removed. Real Telegram cards and sheet rows
  are expected and acceptable.
- Success: real listings appear as Telegram approval cards / sheet rows; re-running the workflow
  immediately produces no duplicates.
