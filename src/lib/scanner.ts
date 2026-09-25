import { yieldToEventLoop } from "./async";
import { getConfig } from "./config";
import {
  getKalshiMarkets,
  getMeta,
  getPolyMarkets,
  listPairs,
  pruneMarkets,
  recordScan,
  saveKalshiMarkets,
  savePolyMarkets,
  setMeta,
} from "./db";
import { EvalOptions, evaluatePair, Opportunity, PairBooks, Skip } from "./evaluate";
import { getKalshiMarket, getKalshiOrderbook, listKalshiMarkets } from "./kalshi/client";
import type { KalshiMarket } from "./kalshi/parse";
import { Decimal } from "./money";
import type { Pair } from "./pairs";
import { getPolyBooks, getPolyMarket, listPolyMarkets } from "./polymarket/client";
import type { PolyMarket } from "./polymarket/parse";

export interface RefreshProgress {
  startedAt: string;
  kalshiPages: number;
  kalshiMarkets: number;
  kalshiDone: boolean;
  polyPages: number;
  polyMarkets: number;
  polyDone: boolean;
}

/** After a failed catalog refresh, wait this long before the poller tries again. */
const REFRESH_RETRY_MS = 5 * 60_000;

interface ScannerState {
  books: Map<number, PairBooks>;
  lastScanAt: string | null;
  lastScanDurationMs: number | null;
  lastScanError: string | null;
  scanning: boolean;
  refreshing: boolean;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshCounts: { kalshi: number; polymarket: number } | null;
  /** When the last refresh (successful or not) finished; failed refreshes wait before retrying. */
  lastRefreshAttemptAt: number | null;
  refreshProgress: RefreshProgress | null;
  pollerStarted: boolean;
  /** "k:<ticker>" / "p:<id>" → time of last failed single-market lookup. */
  missing: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __arbScanner?: ScannerState };
export const state: ScannerState = (g.__arbScanner ??= {
  books: new Map(),
  lastScanAt: null,
  lastScanDurationMs: null,
  lastScanError: null,
  scanning: false,
  refreshing: false,
  lastRefreshAt: null,
  lastRefreshError: null,
  lastRefreshCounts: null,
  lastRefreshAttemptAt: null,
  refreshProgress: null,
  pollerStarted: false,
  missing: new Map(),
  timer: null,
});

/** Pull the full open-market catalogs from both venues into the SQLite cache. */
export async function refreshMarkets(): Promise<{ kalshi: number; polymarket: number }> {
  if (state.refreshing) throw new Error("Market refresh already running");
  state.refreshing = true;
  const started = new Date().toISOString();
  const progress: RefreshProgress = (state.refreshProgress = {
    startedAt: started,
    kalshiPages: 0,
    kalshiMarkets: 0,
    kalshiDone: false,
    polyPages: 0,
    polyMarkets: 0,
    polyDone: false,
  });
  try {
    const counts = { kalshi: 0, polymarket: 0 };
    const [k, p] = await Promise.allSettled([
      listKalshiMarkets({
        onPage: async (page) => {
          saveKalshiMarkets(page);
          counts.kalshi += page.length;
          progress.kalshiPages++;
          progress.kalshiMarkets = counts.kalshi;
          await yieldToEventLoop();
        },
      }).finally(() => (progress.kalshiDone = true)),
      listPolyMarkets({
        onPage: async (page) => {
          savePolyMarkets(page);
          counts.polymarket += page.length;
          progress.polyPages++;
          progress.polyMarkets = counts.polymarket;
          await yieldToEventLoop();
        },
      }).finally(() => (progress.polyDone = true)),
    ]);
    const errors: string[] = [];
    if (k.status === "rejected") errors.push(`Kalshi: ${(k.reason as Error).message}`);
    if (p.status === "rejected") errors.push(`Polymarket: ${(p.reason as Error).message}`);
    // Only drop markets that vanished when both catalogs came through completely.
    if (!errors.length) pruneMarkets(started);
    state.lastRefreshCounts = counts;
    state.lastRefreshError = errors.length ? errors.join("; ") : null;
    if (!errors.length) {
      state.lastRefreshAt = new Date().toISOString();
      setMeta("last_market_refresh", state.lastRefreshAt);
    }
    return counts;
  } finally {
    state.refreshing = false;
    state.refreshProgress = null;
    state.lastRefreshAttemptAt = Date.now();
  }
}

/** Markets for confirmed pairs, fetching individually any that aren't cached yet (e.g. after import). */
async function marketsForPairs(pairs: Pair[]): Promise<{ k: Map<string, KalshiMarket>; p: Map<string, PolyMarket> }> {
  const k = new Map(getKalshiMarkets(pairs.map((x) => x.kalshiTicker)).map((m) => [m.ticker, m]));
  const p = new Map(getPolyMarkets(pairs.map((x) => x.polyMarketId)).map((m) => [m.id, m]));
  // Don't retry a failed lookup more than every 10 minutes.
  const shouldTry = (key: string) => Date.now() - (state.missing.get(key) ?? 0) > 10 * 60_000;
  for (const pair of pairs) {
    const kKey = `k:${pair.kalshiTicker}`;
    if (!k.has(pair.kalshiTicker) && shouldTry(kKey)) {
      const m = await getKalshiMarket(pair.kalshiTicker).catch(() => null);
      if (m) {
        k.set(m.ticker, m);
        saveKalshiMarkets([m]);
        state.missing.delete(kKey);
      } else state.missing.set(kKey, Date.now());
    }
    const pKey = `p:${pair.polyMarketId}`;
    if (!p.has(pair.polyMarketId) && shouldTry(pKey)) {
      const m = await getPolyMarket(pair.polyMarketId).catch(() => null);
      if (m) {
        p.set(m.id, m);
        savePolyMarkets([m]);
        state.missing.delete(pKey);
      } else state.missing.set(pKey, Date.now());
    }
  }
  return { k, p };
}

export function evalOptions(maxCapital: Decimal | null): EvalOptions {
  const c = getConfig();
  return {
    stalenessMs: c.stalenessMs,
    minEdgePerContract: c.minEdgePerContract,
    minLegNotional: c.minLegNotional,
    minContracts: c.minContracts,
    kalshiTakerFeeRate: c.kalshiTakerFeeRate,
    kalshiFeeMultipliers: c.kalshiFeeMultipliers,
    kalshiHonorFeeWaiver: c.kalshiHonorFeeWaiver,
    polyFallbackFeeRate: c.polyFallbackFeeRate,
    maxCapital,
  };
}

/**
 * Fetch books for every confirmed pair. Pairs are processed in chunks sized to roughly one second
 * of Kalshi throttle, and each chunk's Polymarket books are fetched in one batch right after, so
 * the two venues' books for a pair are close together in time.
 */
export async function scanOnce(): Promise<{ opportunities: Opportunity[]; skips: Skip[] }> {
  if (state.scanning) return { opportunities: [], skips: [] };
  state.scanning = true;
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const errors: string[] = [];
  try {
    const pairs = listPairs("confirmed");
    const live = new Set(pairs.map((p) => p.id));
    for (const id of state.books.keys()) if (!live.has(id)) state.books.delete(id);

    const chunkSize = Math.max(1, Math.floor(getConfig().kalshiRequestsPerSecond));
    for (let i = 0; i < pairs.length; i += chunkSize) {
      const chunk = pairs.slice(i, i + chunkSize);
      const kResults = await Promise.allSettled(chunk.map((p) => getKalshiOrderbook(p.kalshiTicker)));
      const tokens = chunk.flatMap((p) => [p.polyTokenForKalshiYes, p.polyTokenForKalshiNo]).filter(Boolean);
      let polyBooks: Awaited<ReturnType<typeof getPolyBooks>> = new Map();
      try {
        polyBooks = await getPolyBooks(tokens);
      } catch (err) {
        errors.push(`Polymarket books: ${(err as Error).message}`);
      }
      chunk.forEach((pair, idx) => {
        const kr = kResults[idx];
        if (kr.status === "rejected") errors.push(`Kalshi ${pair.kalshiTicker}: ${(kr.reason as Error).message}`);
        const poly = new Map();
        for (const t of [pair.polyTokenForKalshiYes, pair.polyTokenForKalshiNo]) {
          const b = polyBooks.get(t);
          if (b) poly.set(t, b);
        }
        state.books.set(pair.id, { kalshi: kr.status === "fulfilled" ? kr.value : null, poly });
      });
    }

    const result = await computeOpportunities(evalOptions(getConfig().defaultMaxCapital), pairs);
    recordScan(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        pairsScanned: pairs.length,
        opportunities: result.opportunities.length,
        errors: errors.length,
        errorSummary: errors.length ? errors.slice(0, 5).join("\n") : null,
      },
      result.opportunities,
    );
    state.lastScanError = errors.length ? errors[0] : null;
    return result;
  } catch (err) {
    state.lastScanError = (err as Error).message;
    throw err;
  } finally {
    state.lastScanAt = startedAt;
    state.lastScanDurationMs = Date.now() - t0;
    state.scanning = false;
  }
}

/** Evaluate the latest books (from the last scan) under the given options. Cheap: no network except for uncached markets. */
export async function computeOpportunities(
  opts: EvalOptions,
  pairs: Pair[] = listPairs("confirmed"),
): Promise<{ opportunities: Opportunity[]; skips: Skip[] }> {
  const { k, p } = await marketsForPairs(pairs);
  const opportunities: Opportunity[] = [];
  const skips: Skip[] = [];
  for (const pair of pairs) {
    const km = k.get(pair.kalshiTicker);
    const pm = p.get(pair.polyMarketId);
    const books = state.books.get(pair.id);
    if (!km || !pm) {
      skips.push({ pairId: pair.id, direction: null, reason: !km ? "Kalshi market not found (closed?)" : "Polymarket market not found or not tradable" });
      continue;
    }
    if (!books) {
      skips.push({ pairId: pair.id, direction: null, reason: "Not scanned yet" });
      continue;
    }
    const r = evaluatePair(pair, km, pm, books, opts);
    opportunities.push(...r.opportunities);
    skips.push(...r.skips);
  }
  opportunities.sort((a, b) => new Decimal(b.profit).comparedTo(a.profit));
  return { opportunities, skips };
}

/** Start the background loop once per process. */
export function startPoller(): void {
  const c = getConfig();
  if (state.pollerStarted || c.disablePoller) return;
  state.pollerStarted = true;
  state.lastRefreshAt ??= getMeta("last_market_refresh");

  const tick = async () => {
    try {
      const lastOk = state.lastRefreshAt ? Date.parse(state.lastRefreshAt) : 0;
      const lastTry = state.lastRefreshAttemptAt ?? 0;
      const due = Date.now() - lastOk > c.marketRefreshIntervalMs && Date.now() - lastTry > REFRESH_RETRY_MS;
      if (!state.refreshing && due) {
        // Don't block scanning of confirmed pairs on the (slow) catalog refresh.
        refreshMarkets().catch((err) => {
          state.lastRefreshError = (err as Error).message;
        });
      }
      await scanOnce();
    } catch (err) {
      state.lastScanError = (err as Error).message;
    } finally {
      state.timer = setTimeout(tick, c.pollIntervalMs);
    }
  };
  state.timer = setTimeout(tick, 1000);
}
