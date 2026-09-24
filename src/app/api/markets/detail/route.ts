import { ensureStarted, json } from "@/lib/api";
import { getKalshiMarkets, getPolyMarkets, saveKalshiMarkets, savePolyMarkets } from "@/lib/db";
import { getKalshiMarket } from "@/lib/kalshi/client";
import { kalshiMarketUrl, polymarketEventUrl } from "@/lib/links";
import { getPolyMarket } from "@/lib/polymarket/client";

export const dynamic = "force-dynamic";

/** GET /api/markets/detail?kalshi=<ticker>&poly=<id> — both markets in full, for side-by-side review. */
export async function GET(req: Request) {
  ensureStarted();
  const u = new URL(req.url);
  const ticker = u.searchParams.get("kalshi")?.trim();
  const polyId = u.searchParams.get("poly")?.trim();
  let kalshi = ticker ? (getKalshiMarkets([ticker])[0] ?? null) : null;
  let poly = polyId ? (getPolyMarkets([polyId])[0] ?? null) : null;
  const errors: string[] = [];
  if (ticker && !kalshi) {
    kalshi = await getKalshiMarket(ticker).catch((e) => (errors.push(`Kalshi: ${e.message}`), null));
    if (kalshi) saveKalshiMarkets([kalshi]);
  }
  if (polyId && !poly) {
    poly = await getPolyMarket(polyId).catch((e) => (errors.push(`Polymarket: ${e.message}`), null));
    if (poly) savePolyMarkets([poly]);
  }
  return json({
    kalshi: kalshi && { ...kalshi, url: kalshiMarketUrl(kalshi) },
    poly: poly && { ...poly, url: polymarketEventUrl(poly) },
    errors,
  });
}
