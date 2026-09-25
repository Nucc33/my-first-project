import { getConfig } from "../config";
import { fetchJson, Throttle } from "../http";
import { KalshiBook, KalshiMarket, KalshiRawMarket, parseKalshiMarket, parseKalshiOrderbook } from "./parse";

const g = globalThis as unknown as { __kalshiThrottle?: Throttle };
function throttle(): Throttle {
  return (g.__kalshiThrottle ??= new Throttle(getConfig().kalshiRequestsPerSecond));
}

function get<T>(path: string): Promise<T> {
  const c = getConfig();
  return fetchJson<T>(`${c.kalshiBaseUrl}${path}`, {
    venue: "kalshi",
    throttle: throttle(),
    maxRetries: c.maxRetries,
    timeoutMs: c.requestTimeoutMs,
  });
}

/**
 * All open binary markets, excluding multivariate combos. Pages until the cursor is empty.
 * With `onPage`, each page is handed over as it arrives instead of being collected.
 */
export async function listKalshiMarkets(
  opts: { maxPages?: number; onPage?: (markets: KalshiMarket[]) => void | Promise<void> } = {},
): Promise<KalshiMarket[]> {
  const out: KalshiMarket[] = [];
  let cursor = "";
  for (let page = 0; page < (opts.maxPages ?? 1000); page++) {
    const qs = new URLSearchParams({ status: "open", mve_filter: "exclude", limit: "1000" });
    if (cursor) qs.set("cursor", cursor);
    const body = await get<{ markets?: KalshiRawMarket[]; cursor?: string | null }>(`/markets?${qs}`);
    const page_: KalshiMarket[] = [];
    for (const raw of body.markets ?? []) {
      const m = parseKalshiMarket(raw);
      if (m) page_.push(m);
    }
    if (opts.onPage) await opts.onPage(page_);
    else out.push(...page_);
    cursor = body.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

export async function getKalshiMarket(ticker: string): Promise<KalshiMarket | null> {
  const body = await get<{ market?: KalshiRawMarket }>(`/markets/${encodeURIComponent(ticker)}`);
  return body.market ? parseKalshiMarket(body.market) : null;
}

export interface TimedKalshiBook {
  ticker: string;
  book: KalshiBook;
  fetchedAt: number;
}

export async function getKalshiOrderbook(ticker: string): Promise<TimedKalshiBook> {
  const body = await get<unknown>(`/markets/${encodeURIComponent(ticker)}/orderbook`);
  return { ticker, book: parseKalshiOrderbook(body), fetchedAt: Date.now() };
}
