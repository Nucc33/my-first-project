# Kalshi ↔ Polymarket Arbitrage Scanner

A **read-only** web app that finds cross-venue hedges between Kalshi and Polymarket binary markets.
For every pair a human has confirmed, it walks both live order books and reports the size at which
buying one side on each venue costs less than the guaranteed $1.00 payout, **after taker fees on both
venues**.

It places no orders and holds no API keys. Every endpoint it calls is public.

> **Read-only scanner. Not financial advice.** Verify both markets' rules before trading. Quotes can
> move before you fill both legs. See [Limitations](#limitations-what-this-scanner-does-not-handle).

## Setup

Requires Node.js ≥ 20.9.

```bash
npm install
cp .env.example .env.local   # optional; every setting has a default
npm run dev                  # http://localhost:3000
npm test                     # unit tests (Vitest)
npm run verify:live          # one live request per endpoint; reports missing/renamed fields
```

Run `npm run verify:live` before relying on the scanner, and again whenever results look wrong.
Both venues change their APIs often. If it reports a missing field, update the parser in
`src/lib/kalshi/parse.ts` or `src/lib/polymarket/parse.ts`.

Data lives in SQLite at `DB_PATH` (default `./data/scanner.sqlite`).

### Typical workflow

1. **Review** tab → **Refresh markets**. This pulls all open Kalshi binary markets and all tradable
   Polymarket markets into the local cache. It takes a while and is repeated every
   `MARKET_REFRESH_INTERVAL_MS`.
2. Pick a candidate (or enter a Kalshi ticker and a Polymarket market id by hand). Read both rule texts
   side by side, map the sides explicitly, and **Confirm** or **Reject**.
3. The **Opportunities** tab shows live results for confirmed pairs. The background poller re-fetches
   books every `POLL_INTERVAL_MS` (15 s by default), and the page refreshes every 5 s.
4. **Pairs** tab: list, remove, and **export / import** reviewed pairs as JSON.
5. **Health** tab: last successful fetch per venue, error counts, HTTP 429 hits, and recent scans.

## Architecture

```
src/lib/
  config.ts            env-driven settings (see .env.example)
  money.ts             decimal.js helpers; no JS floats touch money
  http.ts              throttled fetch (req/s per venue), exponential backoff on 429/5xx, health counters
  kalshi/              client, parsers (bids-only book → derived asks), fee formula
  polymarket/          client (Gamma + CLOB), parsers, fee formula
  arb.ts               the two-book walk (§ Arbitrage math)
  evaluate.ts          per-pair evaluation: directions, staleness, minimums, output formatting
  matching/            title normalization + candidate generation
  pairs.ts, db.ts      confirmed-pair model and SQLite storage (pairs, market cache, scan history)
  scanner.ts           background poller: catalog refresh, book fetches, scan history
src/app/api/           server routes (the browser never calls Kalshi/Polymarket directly)
src/components/        UI tabs
```

Book fetches are grouped so that each pair's Kalshi and Polymarket books are taken close together.
Pairs are processed in chunks of about one second of Kalshi throttle, and each chunk's Polymarket
books are fetched in one `POST /books` batch right after. The Opportunities API re-evaluates the
latest books with your own max-capital setting, so changing filters makes no extra venue requests.

## How matching works

A similar title is **not** enough. A small difference in the rules turns an "arbitrage" into a
naked bet. So pairs are only scanned after a human confirms them.

1. **Candidates (automatic).** Titles are normalized: lowercased, punctuation stripped,
   abbreviations and months expanded (`Fed` → `federal reserve`, `Dec` → `december`,
   `$100k` → `100000`), and stopwords dropped. The Kalshi title is `title` + `yes_sub_title`; the
   Polymarket title is `question`. Each pair is scored as
   `0.8 × text + 0.2 × date`:
   - *text*: IDF-weighted token-set similarity (mean of weighted Jaccard and weighted overlap).
   - *date*: closeness of Kalshi `expected_expiration_time` (else `close_time`) to Polymarket
     `endDateIso`. Pairs more than `MATCH_MAX_CLOSE_DAYS_APART` (3) days apart are rejected
     unless you tick "Include pairs whose close dates are far apart".

   An inverted token index keeps this near-linear, so full catalogs are fine.
2. **Review (manual).** Both markets are shown side by side: full Kalshi `rules_primary` +
   `rules_secondary`, Polymarket `description` and `resolutionSource`, close and resolution dates,
   and fee settings. The reviewer:
   - picks **which Polymarket outcome pays when Kalshi resolves YES**. There is no default, and
     index 0 is never assumed to be "Yes". Sports markets use team names. The other outcome is
     mapped to Kalshi NO.
   - ticks an attestation that the rules match, adds notes, and confirms or rejects.
3. **Storage.** `pairs` table: `kalshi_ticker, poly_market_id, poly_token_for_kalshi_yes,
   poly_token_for_kalshi_no` (plus the outcome labels), `status, category, confirmed_by,
   confirmed_at, notes`. Rejected pairs are stored too, so they don't come back as candidates.
4. **Import / export.** `GET /api/pairs/export` and `POST /api/pairs/import` use the same
   snake_case JSON. Imports are validated: both tokens must be distinct outcomes of that
   Polymarket market.

## Arbitrage math

For each confirmed pair, two directions are checked:

- **A:** buy YES on Kalshi + buy the Polymarket outcome mapped to Kalshi NO
- **B:** buy NO on Kalshi + buy the Polymarket outcome mapped to Kalshi YES

Exactly one leg pays $1.00 per contract at settlement.

**Deriving Kalshi asks.** The Kalshi book holds bids only (`orderbook_fp.yes_dollars` /
`no_dollars`, each `[price, count]`, ascending). A NO bid at `p` is a YES ask at `1 − p`, with the
same size, and vice versa. Polymarket asks come directly from the outcome token's book and are
re-sorted ascending.

**Walk.** Both ask books are walked together. At each step,
`q = min(remaining at Kalshi level, remaining at Polymarket level)`, floored to 0.01 contracts.
The chunk's marginal cost is `q×pK + q×pP + ΔfeeK + ΔfeeP`. A chunk is taken only if that cost is
`< q × (1 − MIN_EDGE_PER_CONTRACT)`. The walk stops at the first unprofitable chunk, when a book runs
out, or at max capital. At the capital limit it takes the largest 0.01-multiple that still fits.

**Fees are per price level, on the aggregated fill.** The marginal fee of a chunk is
`fee(filled_at_level + q) − fee(filled_at_level)`. The walk's decisions therefore agree exactly
with the recomputed totals, and the Kalshi cent rounding is applied once per level, not once per
chunk.

**Output:** contracts; average price, levels consumed and fees per leg; total cost; payout;
net profit; ROI = profit / cost; and annualized ROI = ROI × 365 / days. Days are counted to the
**later** of the two resolution dates, with a minimum of 1 day.

**Guards:**
- The Polymarket leg must be ≥ the book's `min_order_size` (else `orderMinSize`). This is
  denominated in shares.
- Each leg's notional must be ≥ `MIN_LEG_NOTIONAL`, and contracts ≥ `MIN_CONTRACTS`.
- A pair is skipped if its two books were fetched more than `STALENESS_MS` apart (5 s by default)
  or if either book is empty. Every skip and its reason is listed under the Opportunities table.

**Worked example** (a unit test in `tests/arb.test.ts`): Kalshi YES ask $0.42 (best NO bid $0.58)
× 100, and Polymarket NO ask $0.53 × 100 with rate 0.04.
Kalshi fee = ceil_cent(0.07 × 100 × 0.42 × 0.58) = $1.71. Polymarket fee = 100 × 0.04 × 0.53 × 0.47
= $0.99640. Cost = $97.7064, payout $100, profit $2.2936, ROI ≈ 2.35%.

## Fee formulas

**Kalshi** (taker), per price level
([fee schedule](https://kalshi.com/fee-schedule), effective 2026-07-07):

```
fee = ceil_to_cent(KALSHI_TAKER_FEE_RATE (0.07) × multiplier × C × P × (1 − P))
```

- `multiplier` defaults to 1. Override it per series ticker with
  `KALSHI_FEE_MULTIPLIERS=SERIES=0.5,OTHER=0`. The series is `series_ticker` if present, else
  the prefix of `event_ticker` before the first `-`.
- Kalshi rounds more precisely for some account types. Whole-cent ceiling is the conservative choice.
- `fee_waiver_expiration_time` is ignored unless `KALSHI_HONOR_FEE_WAIVER=true`.

**Polymarket** (taker only; makers pay nothing)
([fees](https://docs.polymarket.com/trading/fees)):

```
fee = C × feeSchedule.rate × p × (1 − p), rounded (up) to 5 decimals
```

- `feesEnabled: false` → fee 0.
- `feeSchedule.exponent` ≠ 1 → the market is **skipped and flagged**. The docs don't say how the
  exponent applies.
- Fee-enabled market with no published rate → `POLY_FALLBACK_FEE_RATE` (0.07, the highest
  reference rate), plus a warning on the opportunity.
- Reference rates (docs, Sept 2026): Crypto 0.07; Sports/Economics/Culture/Weather/Other 0.05;
  Politics/Finance/Mentions/Tech 0.04; Geopolitics 0.

## Endpoints used (all public, no auth)

| Venue | Endpoint | Docs |
|---|---|---|
| Kalshi | `GET /markets?status=open&mve_filter=exclude&limit=1000&cursor=…` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| Kalshi | `GET /markets/{ticker}` (pairs whose market isn't cached yet) | same |
| Kalshi | `GET /markets/{ticker}/orderbook` | [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses) |
| Polymarket | `GET gamma-api…/markets/keyset?closed=false&limit=…&after_cursor=…` | [Discover markets](https://docs.polymarket.com/market-data/discover-markets), [Market details](https://docs.polymarket.com/market-data/market-details) |
| Polymarket | `GET gamma-api…/markets/{id}` (uncached pairs) | same |
| Polymarket | `POST clob…/books` (≤ 500 tokens per request) | [Prices & order books](https://docs.polymarket.com/market-data/prices-order-books) |

Throttle: 10 requests/s per venue by default. HTTP 429 and 5xx responses are retried with
exponential backoff (0.5 s, 1 s, 2 s, … capped at 30 s, with jitter). `Retry-After` is honoured.

Market links: `https://kalshi.com/markets/<series ticker, lowercased>` and
`https://polymarket.com/event/<event slug>`. The event slug comes from `events[0].slug`, falling
back to the market slug. **The Kalshi series-path link could not be checked from the build
environment. Open one to confirm it lands on the right market.**

## Limitations: what this scanner does not handle

- **Resolution risk.** Venues can resolve "the same" question differently. Edge cases
  (postponements, rule wording, data sources) cause most failed arbitrages. A confirmed pair is
  only as good as the review behind it.
- **Legging risk.** The second order may not fill at the quoted price. All opportunities are
  **indicative only**. Books are snapshots, and the UI shows their age and the skew between them.
- **Costs not modeled.** Deposits, withdrawals, bridging and FX are not included. Polymarket
  settles in pUSD/USDC and Kalshi in USD. Nor is the cost of capital locked until resolution.
  Annualized ROI is a simple, non-compounding guide.
- **Eligibility.** Whether you can use each platform depends on your jurisdiction. Read
  [Kalshi's terms](https://kalshi.com/terms) and [Polymarket's terms](https://polymarket.com/tos)
  before using either.
- **Fees** are conservative approximations of each venue's published formula. Always confirm the
  fee shown on each venue's order ticket.

## Configuration

Every tunable is listed with comments in [`.env.example`](.env.example): poll interval, catalog
refresh interval, per-venue throttle, retries/timeouts, staleness window, minimum edge, default max
capital, leg minimums, Kalshi fee rate and per-series multipliers, fee-waiver handling, Polymarket
fallback fee rate, matching thresholds, DB path, and a poller kill-switch.
