import { Decimal, Level, sortAsks, toDec } from "../money";

/** Raw Gamma market (only the fields we use). Several fields are JSON-encoded strings. */
export interface PolyRawMarket {
  id: string | number;
  slug?: string;
  question?: string;
  conditionId?: string;
  description?: string;
  endDateIso?: string | null;
  endDate?: string | null;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  negRisk?: boolean;
  orderPriceMinTickSize?: number | string;
  orderMinSize?: number | string;
  feesEnabled?: boolean;
  feeSchedule?: { rate?: number | string; exponent?: number | string; takerOnly?: boolean; rebateRate?: number | string } | null;
  category?: string;
  resolutionSource?: string;
  events?: Array<{ slug?: string; title?: string; category?: string }>;
}

export interface PolyOutcome {
  label: string;
  tokenId: string;
  price: string | null;
}

export interface PolyFeeInfo {
  enabled: boolean;
  /** null when fees are enabled but no schedule was published. */
  rate: string | null;
  exponent: string | null;
}

export interface PolyMarket {
  id: string;
  slug: string;
  eventSlug: string;
  question: string;
  conditionId: string;
  description: string;
  resolutionSource: string;
  endDateIso: string | null;
  negRisk: boolean;
  tickSize: string | null;
  orderMinSize: string | null;
  outcomes: PolyOutcome[];
  fee: PolyFeeInfo;
  category: string | null;
}

/** `outcomes`, `outcomePrices` and `clobTokenIds` arrive as JSON-encoded strings. */
export function parseJsonArray(v: unknown, field: string): string[] {
  if (v == null || v === "") return [];
  const arr = typeof v === "string" ? JSON.parse(v) : v;
  if (!Array.isArray(arr)) throw new Error(`Polymarket ${field} is not an array`);
  return arr.map((x) => String(x));
}

/** Tradable = active, not closed, accepting orders, order book enabled. */
export function isTradablePolyMarket(raw: PolyRawMarket): boolean {
  return raw.active === true && raw.closed === false && raw.acceptingOrders === true && raw.enableOrderBook === true;
}

/** Returns null for non-tradable or malformed markets. Outcome order is preserved; never assume index 0 is "Yes". */
export function parsePolyMarket(raw: PolyRawMarket): PolyMarket | null {
  if (!raw || raw.id == null || !isTradablePolyMarket(raw)) return null;
  let labels: string[], tokens: string[], prices: string[];
  try {
    labels = parseJsonArray(raw.outcomes, "outcomes");
    tokens = parseJsonArray(raw.clobTokenIds, "clobTokenIds");
    prices = parseJsonArray(raw.outcomePrices, "outcomePrices");
  } catch {
    return null;
  }
  // Only two-outcome markets can hedge a binary Kalshi contract.
  if (labels.length !== 2 || tokens.length !== 2) return null;
  const fs = raw.feeSchedule ?? null;
  return {
    id: String(raw.id),
    slug: raw.slug ?? "",
    eventSlug: raw.events?.[0]?.slug ?? raw.slug ?? "",
    question: raw.question ?? "",
    conditionId: raw.conditionId ?? "",
    description: raw.description ?? "",
    resolutionSource: raw.resolutionSource ?? "",
    endDateIso: raw.endDateIso ?? raw.endDate ?? null,
    negRisk: raw.negRisk === true,
    tickSize: raw.orderPriceMinTickSize != null ? String(raw.orderPriceMinTickSize) : null,
    orderMinSize: raw.orderMinSize != null ? String(raw.orderMinSize) : null,
    outcomes: labels.map((label, i) => ({ label, tokenId: tokens[i], price: prices[i] ?? null })),
    fee: {
      enabled: raw.feesEnabled === true,
      rate: fs?.rate != null ? String(fs.rate) : null,
      exponent: fs?.exponent != null ? String(fs.exponent) : null,
    },
    category: raw.category ?? raw.events?.[0]?.category ?? null,
  };
}

export interface PolyBook {
  tokenId: string;
  market: string;
  /** Asks sorted ascending by price (best first). */
  asks: Level[];
  /** Bids sorted descending by price (best first). */
  bids: Level[];
  tickSize: string | null;
  minOrderSize: string | null;
  timestamp: string | null;
}

function parseSide(raw: unknown, field: string): Level[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`Polymarket book ${field} is not an array`);
  return raw.map((l: { price?: unknown; size?: unknown }, i) => ({
    price: toDec(l?.price, `${field}[${i}].price`),
    size: toDec(l?.size, `${field}[${i}].size`),
  }));
}

/** Docs say bids ascend and asks descend (best last). We re-sort explicitly regardless. */
export function parsePolyBook(raw: unknown): PolyBook {
  const b = raw as Record<string, unknown>;
  if (!b || typeof b !== "object" || b.asset_id == null) throw new Error("Polymarket book missing asset_id");
  const bids = parseSide(b.bids, "bids")
    .filter((l) => l.size.greaterThan(0))
    .sort((x, y) => y.price.comparedTo(x.price));
  return {
    tokenId: String(b.asset_id),
    market: String(b.market ?? ""),
    asks: sortAsks(parseSide(b.asks, "asks")),
    bids,
    tickSize: b.tick_size != null ? String(b.tick_size) : null,
    minOrderSize: b.min_order_size != null ? String(b.min_order_size) : null,
    timestamp: b.timestamp != null ? String(b.timestamp) : null,
  };
}

export type { Decimal };
