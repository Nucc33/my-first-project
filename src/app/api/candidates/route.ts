import { ensureStarted, json, serverError } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getKalshiMarkets, getPolyMarkets, listPairs, marketCounts } from "@/lib/db";
import { Candidate, generateCandidates, pairKey } from "@/lib/matching/candidates";
import { state } from "@/lib/scanner";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __candCache?: { key: string; list: Candidate[] } };

/** GET /api/candidates?ignoreDates=1 — top automatic match candidates not yet reviewed. */
export async function GET(req: Request) {
  ensureStarted();
  const u = new URL(req.url);
  const ignoreDates = u.searchParams.get("ignoreDates") === "1";
  try {
    const c = getConfig();
    const reviewed = listPairs();
    const counts = marketCounts();
    const key = [state.lastRefreshAt, counts.kalshi, counts.polymarket, ignoreDates, reviewed.length, reviewed.at(-1)?.id].join("|");
    let list = g.__candCache?.key === key ? g.__candCache.list : null;
    if (!list) {
      list = generateCandidates(getKalshiMarkets(), getPolyMarkets(), {
        maxCloseDaysApart: c.matchMaxCloseDaysApart,
        ignoreDates,
        minScore: c.matchMinScore,
        limit: c.matchMaxCandidates,
        exclude: new Set(reviewed.map((p) => pairKey(p.kalshiTicker, p.polyMarketId))),
      });
      g.__candCache = { key, list };
    }
    return json({ candidates: list, counts, lastRefreshAt: state.lastRefreshAt, refreshing: state.refreshing, refreshError: state.lastRefreshError });
  } catch (err) {
    return serverError(err);
  }
}
