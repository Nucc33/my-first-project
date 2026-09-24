import type { Direction } from "./arb";
import type { KalshiSide } from "./kalshi/parse";
import type { PolyMarket } from "./polymarket/parse";

export type PairStatus = "confirmed" | "rejected";

/** A human-reviewed pairing. Only `confirmed` pairs are scanned. */
export interface Pair {
  id: number;
  kalshiTicker: string;
  polyMarketId: string;
  /** Polymarket token that pays out exactly when Kalshi resolves YES. */
  polyTokenForKalshiYes: string;
  /** Polymarket token that pays out exactly when Kalshi resolves NO. */
  polyTokenForKalshiNo: string;
  polyOutcomeForKalshiYes: string;
  polyOutcomeForKalshiNo: string;
  status: PairStatus;
  category: string | null;
  confirmedBy: string;
  confirmedAt: string;
  notes: string;
}

export interface PairInput {
  kalshiTicker: string;
  polyMarketId: string;
  polyTokenForKalshiYes: string;
  polyTokenForKalshiNo: string;
  polyOutcomeForKalshiYes?: string;
  polyOutcomeForKalshiNo?: string;
  status?: PairStatus;
  category?: string | null;
  confirmedBy: string;
  confirmedAt?: string;
  notes?: string;
}

export interface DirectionLegs {
  direction: Direction;
  kalshiSide: KalshiSide;
  polyTokenId: string;
  polyOutcome: string;
}

/**
 * A: Kalshi YES + the Polymarket outcome that pays when Kalshi is NO.
 * B: Kalshi NO  + the Polymarket outcome that pays when Kalshi is YES.
 */
export function legsForDirection(pair: Pick<Pair, "polyTokenForKalshiYes" | "polyTokenForKalshiNo" | "polyOutcomeForKalshiYes" | "polyOutcomeForKalshiNo">, direction: Direction): DirectionLegs {
  return direction === "A"
    ? { direction, kalshiSide: "yes", polyTokenId: pair.polyTokenForKalshiNo, polyOutcome: pair.polyOutcomeForKalshiNo }
    : { direction, kalshiSide: "no", polyTokenId: pair.polyTokenForKalshiYes, polyOutcome: pair.polyOutcomeForKalshiYes };
}

/**
 * Validates a pair against its Polymarket market: both tokens must belong to the market, be
 * different, and cover both outcomes. Returns a list of problems (empty = OK).
 */
export function validatePairMapping(input: PairInput, poly: PolyMarket | null): string[] {
  const errs: string[] = [];
  if (!input.kalshiTicker) errs.push("kalshiTicker is required");
  if (!input.polyMarketId) errs.push("polyMarketId is required");
  if (!input.confirmedBy?.trim()) errs.push("confirmedBy is required");
  if (input.status === "rejected") return errs;
  if (!input.polyTokenForKalshiYes || !input.polyTokenForKalshiNo) errs.push("Both Polymarket token mappings are required");
  if (input.polyTokenForKalshiYes && input.polyTokenForKalshiYes === input.polyTokenForKalshiNo) {
    errs.push("Kalshi YES and NO must map to different Polymarket outcomes");
  }
  if (poly) {
    const ids = new Set(poly.outcomes.map((o) => o.tokenId));
    for (const t of [input.polyTokenForKalshiYes, input.polyTokenForKalshiNo]) {
      if (t && !ids.has(t)) errs.push(`Token ${t} is not an outcome of Polymarket market ${poly.id}`);
    }
  }
  return errs;
}

/** Fill outcome labels from the market when they were not supplied (e.g. JSON import). */
export function withOutcomeLabels(input: PairInput, poly: PolyMarket | null): PairInput {
  const label = (token: string) => poly?.outcomes.find((o) => o.tokenId === token)?.label ?? "";
  return {
    ...input,
    polyOutcomeForKalshiYes: input.polyOutcomeForKalshiYes || label(input.polyTokenForKalshiYes),
    polyOutcomeForKalshiNo: input.polyOutcomeForKalshiNo || label(input.polyTokenForKalshiNo),
  };
}

/** Portable JSON form, using the snake_case field names of the pairs table. */
export interface PairJson {
  kalshi_ticker: string;
  poly_market_id: string;
  poly_token_for_kalshi_yes: string;
  poly_token_for_kalshi_no: string;
  poly_outcome_for_kalshi_yes?: string;
  poly_outcome_for_kalshi_no?: string;
  status?: PairStatus;
  category?: string | null;
  confirmed_by: string;
  confirmed_at?: string;
  notes?: string;
}

export function pairToJson(p: Pair): PairJson {
  return {
    kalshi_ticker: p.kalshiTicker,
    poly_market_id: p.polyMarketId,
    poly_token_for_kalshi_yes: p.polyTokenForKalshiYes,
    poly_token_for_kalshi_no: p.polyTokenForKalshiNo,
    poly_outcome_for_kalshi_yes: p.polyOutcomeForKalshiYes,
    poly_outcome_for_kalshi_no: p.polyOutcomeForKalshiNo,
    status: p.status,
    category: p.category,
    confirmed_by: p.confirmedBy,
    confirmed_at: p.confirmedAt,
    notes: p.notes,
  };
}

/** Accepts either the snake_case export format or camelCase PairInput. */
export function pairInputFromJson(raw: unknown): PairInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (snake: string, camel: string): string | undefined => {
    const v = r[snake] ?? r[camel];
    return v == null ? undefined : String(v);
  };
  const status = s("status", "status");
  if (status !== undefined && status !== "confirmed" && status !== "rejected") {
    throw new Error(`Invalid status "${status}"`);
  }
  return {
    kalshiTicker: (s("kalshi_ticker", "kalshiTicker") ?? "").trim(),
    polyMarketId: (s("poly_market_id", "polyMarketId") ?? "").trim(),
    polyTokenForKalshiYes: (s("poly_token_for_kalshi_yes", "polyTokenForKalshiYes") ?? "").trim(),
    polyTokenForKalshiNo: (s("poly_token_for_kalshi_no", "polyTokenForKalshiNo") ?? "").trim(),
    polyOutcomeForKalshiYes: s("poly_outcome_for_kalshi_yes", "polyOutcomeForKalshiYes"),
    polyOutcomeForKalshiNo: s("poly_outcome_for_kalshi_no", "polyOutcomeForKalshiNo"),
    status: status as PairStatus | undefined,
    category: s("category", "category") ?? null,
    confirmedBy: (s("confirmed_by", "confirmedBy") ?? "").trim(),
    confirmedAt: s("confirmed_at", "confirmedAt"),
    notes: s("notes", "notes") ?? "",
  };
}
