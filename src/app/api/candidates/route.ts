import { ensureStarted, json, serverError } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { listPairs, loadAllKalshiMarkets, loadAllPolyMarkets, marketCounts } from "@/lib/db";
import { Candidate, generateCandidates, pairKey } from "@/lib/matching/candidates";
import { state } from "@/lib/scanner";

export const dynamic = "force-dynamic";

interface CandCache {
  key: string;
  list?: Candidate[];
  /** Shared by concurrent requests so a slow computation only runs once. */
  pending?: Promise<Candidate[]>;
}
const g = globalThis as unknown as { __candCache?: CandCache };

/** GET /api/candidates?ignoreDates=1 — top automatic match candidates not yet reviewed. */
export async function GET(req: Request) {
  ensureStarted();
  const u = new URL(req.url);
  const ignoreDates = u.searchParams.get("ignoreDates") === "1";
  const meta = {
    lastRefreshAt: state.lastRefreshAt,
    refreshing: state.refreshing,
    refreshProgress: state.refreshProgress,
    refreshError: state.lastRefreshError,
  };
  try {
    const c = getConfig();
    const reviewed = listPairs();
    const counts = marketCounts();
    // During a refresh the counts change constantly; score what is cached once per refresh
    // (so candidates appear without waiting for the whole catalog) rather than on every poll.
    const version = state.refreshProgress ? `refreshing:${state.refreshProgress.startedAt}` : `${state.lastRefreshAt}|${counts.kalshi}|${counts.polymarket}`;
    const key = [version, ignoreDates, reviewed.length, reviewed.at(-1)?.id].join("|");
    let cache = g.__candCache;
    if (cache?.key !== key) {
      const pending = (async () => {
        const [k, p] = [await loadAllKalshiMarkets(), await loadAllPolyMarkets()];
        return generateCandidates(k, p, {
          maxCloseDaysApart: c.matchMaxCloseDaysApart,
          ignoreDates,
          minScore: c.matchMinScore,
          limit: c.matchMaxCandidates,
          exclude: new Set(reviewed.map((x) => pairKey(x.kalshiTicker, x.polyMarketId))),
        });
      })();
      cache = g.__candCache = { key, pending };
      pending.then(
        (list) => {
          if (g.__candCache?.key === key) g.__candCache = { key, list };
        },
        () => {
          if (g.__candCache?.key === key) g.__candCache = undefined;
        },
      );
    }
    const list = cache.list ?? (await cache.pending!);
    return json({ candidates: list, counts, partial: key.startsWith("refreshing:"), ...meta });
  } catch (err) {
    return serverError(err);
  }
}
