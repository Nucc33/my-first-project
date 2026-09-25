import { getConfig } from "../config";
import { fetchJson, Throttle } from "../http";
import { parsePolyBook, parsePolyMarket, PolyBook, PolyMarket, PolyRawMarket } from "./parse";

const g = globalThis as unknown as { __polyThrottle?: Throttle };
function throttle(): Throttle {
  return (g.__polyThrottle ??= new Throttle(getConfig().polyRequestsPerSecond));
}

function req<T>(url: string, init?: RequestInit): Promise<T> {
  const c = getConfig();
  return fetchJson<T>(url, {
    venue: "polymarket",
    throttle: throttle(),
    maxRetries: c.maxRetries,
    timeoutMs: c.requestTimeoutMs,
    init,
  });
}

/** The keyset endpoint has returned both a bare array and a wrapped object; accept either. */
export function unwrapKeysetPage(body: unknown): { markets: PolyRawMarket[]; next: string | null } {
  if (Array.isArray(body)) return { markets: body as PolyRawMarket[], next: null };
  const b = (body ?? {}) as Record<string, unknown>;
  const markets = (b.markets ?? b.data ?? []) as PolyRawMarket[];
  const next = (b.next_cursor ?? b.nextCursor ?? null) as string | null;
  return { markets: Array.isArray(markets) ? markets : [], next: next || null };
}

/**
 * All tradable two-outcome markets. Pages until there is no next_cursor.
 * With `onPage`, each page is handed over as it arrives instead of being collected.
 */
export async function listPolyMarkets(
  opts: { maxPages?: number; pageSize?: number; onPage?: (markets: PolyMarket[]) => void | Promise<void> } = {},
): Promise<PolyMarket[]> {
  const c = getConfig();
  const out: PolyMarket[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < (opts.maxPages ?? 1000); page++) {
    const qs = new URLSearchParams({ closed: "false", limit: String(opts.pageSize ?? 500) });
    if (cursor) qs.set("after_cursor", cursor);
    const { markets, next } = unwrapKeysetPage(await req<unknown>(`${c.polyGammaBaseUrl}/markets/keyset?${qs}`));
    const page_: PolyMarket[] = [];
    for (const raw of markets) {
      const m = parsePolyMarket(raw);
      if (m) page_.push(m);
    }
    if (opts.onPage) await opts.onPage(page_);
    else out.push(...page_);
    if (!next || next === cursor || markets.length === 0) break;
    cursor = next;
  }
  return out;
}

export async function getPolyMarket(id: string): Promise<PolyMarket | null> {
  const c = getConfig();
  const raw = await req<PolyRawMarket>(`${c.polyGammaBaseUrl}/markets/${encodeURIComponent(id)}`);
  return parsePolyMarket(raw);
}

export interface TimedPolyBook {
  book: PolyBook;
  fetchedAt: number;
}

/** POST /books, up to 500 token IDs per request. Returned map is keyed by token ID. */
export async function getPolyBooks(tokenIds: string[]): Promise<Map<string, TimedPolyBook>> {
  const c = getConfig();
  const out = new Map<string, TimedPolyBook>();
  const unique = [...new Set(tokenIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const body = await req<unknown[]>(`${c.polyClobBaseUrl}/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chunk.map((token_id) => ({ token_id }))),
    });
    const fetchedAt = Date.now();
    for (const raw of Array.isArray(body) ? body : []) {
      const book = parsePolyBook(raw);
      out.set(book.tokenId, { book, fetchedAt });
    }
  }
  return out;
}
