import { Decimal, Level, ONE, sortAsks, toDec } from "../money";

/** Raw market as returned by GET /markets (only fields we use). */
export interface KalshiRawMarket {
  ticker: string;
  event_ticker: string;
  series_ticker?: string;
  market_type?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  rules_primary?: string;
  rules_secondary?: string;
  close_time?: string;
  expected_expiration_time?: string | null;
  expiration_time?: string | null;
  status?: string;
  yes_ask_dollars?: string | null;
  no_ask_dollars?: string | null;
  price_ranges?: unknown;
  fee_waiver_expiration_time?: string | null;
  category?: string;
}

/** Normalized Kalshi market as stored in our cache. */
export interface KalshiMarket {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  yesSubTitle: string;
  noSubTitle: string;
  rulesPrimary: string;
  rulesSecondary: string;
  closeTime: string | null;
  expectedExpirationTime: string | null;
  status: string;
  yesAsk: string | null;
  noAsk: string | null;
  priceRanges: unknown;
  feeWaiverExpirationTime: string | null;
  category: string | null;
}

/**
 * Series ticker. The markets list does not always include `series_ticker`;
 * by Kalshi convention the event ticker is "<SERIES>-<suffix>".
 */
export function seriesFromEventTicker(eventTicker: string): string {
  return (eventTicker.split("-")[0] ?? eventTicker).toUpperCase();
}

/** Returns null for markets we don't scan (non-binary). */
export function parseKalshiMarket(raw: KalshiRawMarket): KalshiMarket | null {
  if (!raw || typeof raw.ticker !== "string") return null;
  if (raw.market_type && raw.market_type !== "binary") return null;
  const eventTicker = raw.event_ticker ?? "";
  return {
    ticker: raw.ticker,
    eventTicker,
    seriesTicker: (raw.series_ticker || seriesFromEventTicker(eventTicker || raw.ticker)).toUpperCase(),
    title: raw.title ?? "",
    yesSubTitle: raw.yes_sub_title ?? raw.subtitle ?? "",
    noSubTitle: raw.no_sub_title ?? "",
    rulesPrimary: raw.rules_primary ?? "",
    rulesSecondary: raw.rules_secondary ?? "",
    closeTime: raw.close_time ?? null,
    expectedExpirationTime: raw.expected_expiration_time ?? raw.expiration_time ?? null,
    status: raw.status ?? "",
    yesAsk: raw.yes_ask_dollars ?? null,
    noAsk: raw.no_ask_dollars ?? null,
    priceRanges: raw.price_ranges ?? null,
    feeWaiverExpirationTime: raw.fee_waiver_expiration_time ?? null,
    category: raw.category ?? null,
  };
}

/** Human-readable question used for matching and display. */
export function kalshiDisplayTitle(m: KalshiMarket): string {
  if (m.yesSubTitle && !m.title.toLowerCase().includes(m.yesSubTitle.toLowerCase())) {
    return `${m.title} — ${m.yesSubTitle}`;
  }
  return m.title || m.ticker;
}

export interface KalshiBook {
  /** Bids to buy YES, as returned (any order). */
  yesBids: Level[];
  /** Bids to buy NO, as returned (any order). */
  noBids: Level[];
  /** Asks to buy YES, derived from NO bids, best (cheapest) first. */
  yesAsks: Level[];
  /** Asks to buy NO, derived from YES bids, best (cheapest) first. */
  noAsks: Level[];
}

function parseLevels(raw: unknown, field: string): Level[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`Kalshi orderbook ${field} is not an array`);
  return raw.map((lvl, i) => {
    if (!Array.isArray(lvl) || lvl.length < 2) throw new Error(`Kalshi orderbook ${field}[${i}] malformed`);
    return { price: toDec(lvl[0], `${field}[${i}].price`), size: toDec(lvl[1], `${field}[${i}].count`) };
  });
}

/**
 * The Kalshi book holds bids only. A NO bid at p is a YES ask at 1 − p (same size),
 * and a YES bid at p is a NO ask at 1 − p.
 */
export function parseKalshiOrderbook(body: unknown): KalshiBook {
  const b = body as Record<string, unknown> | null;
  const ob = (b?.orderbook_fp ?? b?.orderbook) as Record<string, unknown> | null | undefined;
  if (!ob || typeof ob !== "object") throw new Error("Kalshi orderbook response missing orderbook_fp");
  const yesBids = parseLevels(ob.yes_dollars ?? ob.yes, "yes_dollars");
  const noBids = parseLevels(ob.no_dollars ?? ob.no, "no_dollars");
  const flip = (lvls: Level[]): Level[] => sortAsks(lvls.map((l) => ({ price: ONE.minus(l.price), size: l.size })));
  return { yesBids, noBids, yesAsks: flip(noBids), noAsks: flip(yesBids) };
}

export type KalshiSide = "yes" | "no";

export function kalshiAsks(book: KalshiBook, side: KalshiSide): Level[] {
  return side === "yes" ? book.yesAsks : book.noAsks;
}

export type { Decimal };
