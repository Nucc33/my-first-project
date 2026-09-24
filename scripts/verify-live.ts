/**
 * npm run verify:live
 *
 * Makes one live request to each public endpoint the scanner uses and reports which expected
 * fields are present. Run it before trusting the scanner, and again whenever results look off.
 * The APIs change often.
 */
import { loadConfig } from "../src/lib/config";

const c = loadConfig();
let failures = 0;

async function get(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function check(label: string, obj: unknown, fields: string[]): void {
  const o = (obj ?? {}) as Record<string, unknown>;
  const missing = fields.filter((f) => !(f in o));
  const present = fields.filter((f) => f in o);
  console.log(`\n${label}`);
  console.log(`  present: ${present.join(", ") || "(none)"}`);
  if (missing.length) {
    failures++;
    console.log(`  MISSING: ${missing.join(", ")}`);
  }
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`\n${name}\n  FAILED: ${(err as Error).message}`);
  }
}

async function main() {
  let kalshiTicker: string | undefined;
  await step("Kalshi GET /markets", async () => {
    const body = (await get(`${c.kalshiBaseUrl}/markets?status=open&mve_filter=exclude&limit=5`)) as { markets?: unknown[] };
    check("Kalshi GET /markets (top level)", body, ["markets", "cursor"]);
    const m = (body.markets ?? [])[0] as Record<string, unknown> | undefined;
    check("Kalshi market object", m, [
      "ticker", "event_ticker", "market_type", "title", "yes_sub_title", "no_sub_title", "rules_primary",
      "rules_secondary", "close_time", "expected_expiration_time", "status", "yes_ask_dollars", "no_ask_dollars",
      "price_ranges", "fee_waiver_expiration_time",
    ]);
    kalshiTicker = m?.ticker as string | undefined;
  });

  if (kalshiTicker) {
    await step("Kalshi GET /markets/{ticker}/orderbook", async () => {
      const body = (await get(`${c.kalshiBaseUrl}/markets/${kalshiTicker}/orderbook`)) as Record<string, unknown>;
      check(`Kalshi orderbook (${kalshiTicker})`, body, ["orderbook_fp"]);
      const ob = body.orderbook_fp as Record<string, unknown> | undefined;
      check("Kalshi orderbook_fp", ob, ["yes_dollars", "no_dollars"]);
      const lvl = (ob?.yes_dollars as unknown[] | undefined)?.[0] ?? (ob?.no_dollars as unknown[] | undefined)?.[0];
      console.log(`  sample level: ${JSON.stringify(lvl)}  (expected ["price","count"] strings)`);
    });
  }

  let tokenIds: string[] = [];
  await step("Polymarket GET /markets/keyset", async () => {
    const body = await get(`${c.polyGammaBaseUrl}/markets/keyset?closed=false&limit=5`);
    const isArray = Array.isArray(body);
    console.log(`\nPolymarket keyset shape: ${isArray ? "bare array" : `object with keys ${Object.keys(body as object).join(", ")}`}`);
    const markets = (isArray ? body : ((body as Record<string, unknown>).markets ?? (body as Record<string, unknown>).data)) as Record<string, unknown>[];
    if (!isArray) check("Polymarket keyset (top level)", body, ["next_cursor"]);
    const m = markets?.find((x) => x.enableOrderBook && x.acceptingOrders) ?? markets?.[0];
    check("Polymarket market object", m, [
      "id", "slug", "question", "conditionId", "description", "endDateIso", "active", "closed", "acceptingOrders",
      "enableOrderBook", "outcomes", "outcomePrices", "clobTokenIds", "negRisk", "orderPriceMinTickSize", "orderMinSize",
      "feesEnabled", "feeSchedule", "events",
    ]);
    if (m?.feeSchedule) check("Polymarket feeSchedule", m.feeSchedule, ["rate", "exponent", "takerOnly", "rebateRate"]);
    console.log(`  outcomes type: ${typeof m?.outcomes} (expected JSON-encoded string)`);
    tokenIds = typeof m?.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds as string) : ((m?.clobTokenIds as string[]) ?? []);
  });

  if (tokenIds.length) {
    await step("Polymarket GET /book", async () => {
      const body = await get(`${c.polyClobBaseUrl}/book?token_id=${tokenIds[0]}`);
      check("Polymarket GET /book", body, ["asset_id", "market", "timestamp", "bids", "asks", "tick_size", "min_order_size", "neg_risk", "hash"]);
    });
    await step("Polymarket POST /books", async () => {
      const body = (await get(`${c.polyClobBaseUrl}/books`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tokenIds.map((token_id) => ({ token_id }))),
      })) as unknown[];
      console.log(`\nPolymarket POST /books: ${Array.isArray(body) ? `array of ${body.length}` : typeof body}`);
      if (Array.isArray(body)) check("Polymarket POST /books[0]", body[0], ["asset_id", "bids", "asks", "min_order_size"]);
      else failures++;
    });
  }

  console.log(failures ? `\n${failures} problem(s) found. Update the parsers in src/lib/*/parse.ts.` : "\nAll expected fields present.");
  process.exit(failures ? 1 : 0);
}

main();
