import type { KalshiMarket } from "./kalshi/parse";
import type { PolyMarket } from "./polymarket/parse";

/**
 * Kalshi market pages live under /markets/<series>/…; the series path (lowercased) redirects to
 * the current event. Not verified live from this build environment — see README.
 */
export function kalshiMarketUrl(m: Pick<KalshiMarket, "seriesTicker" | "eventTicker">): string {
  const series = m.seriesTicker.toLowerCase();
  return `https://kalshi.com/markets/${encodeURIComponent(series)}`;
}

export function polymarketEventUrl(m: Pick<PolyMarket, "eventSlug" | "slug">): string {
  return `https://polymarket.com/event/${encodeURIComponent(m.eventSlug || m.slug)}`;
}
