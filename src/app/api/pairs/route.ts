import { badRequest, ensureStarted, json, serverError } from "@/lib/api";
import { getKalshiMarkets, getPolyMarkets, listPairs } from "@/lib/db";
import { savePairDecision } from "@/lib/pairService";
import { pairInputFromJson } from "@/lib/pairs";

export const dynamic = "force-dynamic";

/** GET /api/pairs — all reviewed pairs with titles for display. */
export async function GET() {
  ensureStarted();
  const pairs = listPairs();
  const k = new Map(getKalshiMarkets(pairs.map((p) => p.kalshiTicker)).map((m) => [m.ticker, m]));
  const p = new Map(getPolyMarkets(pairs.map((x) => x.polyMarketId)).map((m) => [m.id, m]));
  return json({
    pairs: pairs.map((pair) => ({
      ...pair,
      kalshiTitle: k.get(pair.kalshiTicker)?.title ?? null,
      kalshiYesSubTitle: k.get(pair.kalshiTicker)?.yesSubTitle ?? null,
      polyQuestion: p.get(pair.polyMarketId)?.question ?? null,
    })),
  });
}

/** POST /api/pairs — confirm or reject a pair (upsert on kalshi_ticker + poly_market_id). */
export async function POST(req: Request) {
  ensureStarted();
  let input;
  try {
    input = pairInputFromJson(await req.json());
  } catch (err) {
    return badRequest((err as Error).message);
  }
  try {
    const { pair, errors } = await savePairDecision(input);
    if (errors.length) return badRequest(errors);
    return json({ pair });
  } catch (err) {
    return serverError(err);
  }
}
