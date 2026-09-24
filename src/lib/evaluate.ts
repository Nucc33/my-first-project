import { annualize, ArbFill, daysUntil, Direction, walkBooks } from "./arb";
import type { Config } from "./config";
import { kalshiFeeParamsFor } from "./kalshi/fees";
import { kalshiAsks, KalshiBook, kalshiDisplayTitle, KalshiMarket } from "./kalshi/parse";
import { kalshiMarketUrl, polymarketEventUrl } from "./links";
import { Decimal } from "./money";
import { legsForDirection, Pair } from "./pairs";
import { resolvePolyFee } from "./polymarket/fees";
import type { PolyBook, PolyMarket } from "./polymarket/parse";

export interface BookSnapshot<B> {
  book: B;
  fetchedAt: number;
}

export interface PairBooks {
  kalshi: BookSnapshot<KalshiBook> | null;
  /** Keyed by Polymarket token ID. */
  poly: Map<string, BookSnapshot<PolyBook>>;
}

export type EvalOptions = Pick<
  Config,
  | "stalenessMs"
  | "minEdgePerContract"
  | "minLegNotional"
  | "minContracts"
  | "kalshiTakerFeeRate"
  | "kalshiFeeMultipliers"
  | "kalshiHonorFeeWaiver"
  | "polyFallbackFeeRate"
> & { maxCapital: Decimal | null; now?: number };

/** JSON-friendly opportunity (all money as decimal strings). */
export interface Opportunity {
  pairId: number;
  direction: Direction;
  label: string;
  kalshiTicker: string;
  kalshiSide: "yes" | "no";
  kalshiTitle: string;
  kalshiUrl: string;
  polyMarketId: string;
  polyOutcome: string;
  polyQuestion: string;
  polyUrl: string;
  category: string | null;
  contracts: string;
  kalshi: LegSummary;
  poly: LegSummary;
  totalCost: string;
  payout: string;
  profit: string;
  roi: string;
  annualizedRoi: string | null;
  daysToResolution: number | null;
  /** Timestamp of the older of the two books (ms since epoch). */
  bookFetchedAt: number;
  bookSkewMs: number;
  warnings: string[];
}

export interface LegSummary {
  avgPrice: string;
  notional: string;
  fees: string;
  levelsConsumed: number;
  levels: Array<{ price: string; contracts: string; fee: string }>;
}

export interface Skip {
  pairId: number;
  direction: Direction | null;
  reason: string;
}

export interface PairEvaluation {
  opportunities: Opportunity[];
  skips: Skip[];
}

function legSummary(l: ArbFill["kalshi"]): LegSummary {
  return {
    avgPrice: l.avgPrice.toFixed(4),
    notional: l.notional.toFixed(4),
    fees: l.fees.toFixed(5),
    levelsConsumed: l.levels.length,
    levels: l.levels.map((x) => ({ price: x.price.toFixed(4), contracts: x.contracts.toFixed(2), fee: x.fee.toFixed(5) })),
  };
}

/** Evaluate both directions for one confirmed pair against its latest books. */
export function evaluatePair(
  pair: Pair,
  kMarket: KalshiMarket,
  pMarket: PolyMarket,
  books: PairBooks,
  opts: EvalOptions,
): PairEvaluation {
  const skips: Skip[] = [];
  const opportunities: Opportunity[] = [];
  const skip = (direction: Direction | null, reason: string) => skips.push({ pairId: pair.id, direction, reason });

  const polyFee = resolvePolyFee(pMarket.fee, opts.polyFallbackFeeRate);
  if (!polyFee.ok) {
    skip(null, polyFee.reason);
    return { opportunities, skips };
  }
  if (!books.kalshi) {
    skip(null, "Kalshi book not fetched");
    return { opportunities, skips };
  }
  const kalshiFee = kalshiFeeParamsFor(kMarket.seriesTicker, {
    rate: opts.kalshiTakerFeeRate,
    multipliers: opts.kalshiFeeMultipliers,
    honorWaiver: opts.kalshiHonorFeeWaiver,
    feeWaiverExpirationTime: kMarket.feeWaiverExpirationTime,
    now: opts.now ? new Date(opts.now) : undefined,
  });
  const days = daysUntil([kMarket.expectedExpirationTime ?? kMarket.closeTime, pMarket.endDateIso], opts.now);

  for (const direction of ["A", "B"] as const) {
    const legs = legsForDirection(pair, direction);
    const pBook = books.poly.get(legs.polyTokenId);
    if (!pBook) {
      skip(direction, `Polymarket book for ${legs.polyOutcome || legs.polyTokenId} not fetched`);
      continue;
    }
    const skew = Math.abs(books.kalshi.fetchedAt - pBook.fetchedAt);
    if (skew > opts.stalenessMs) {
      skip(direction, `Books fetched ${skew} ms apart (limit ${opts.stalenessMs} ms)`);
      continue;
    }
    const kAsks = kalshiAsks(books.kalshi.book, legs.kalshiSide);
    if (kAsks.length === 0) {
      skip(direction, `Kalshi ${legs.kalshiSide.toUpperCase()} side has no asks`);
      continue;
    }
    if (pBook.book.asks.length === 0) {
      skip(direction, `Polymarket "${legs.polyOutcome}" has no asks`);
      continue;
    }

    const fill = walkBooks({
      kalshiAsks: kAsks,
      polyAsks: pBook.book.asks,
      kalshiFee,
      polyFee: polyFee.params,
      minEdgePerContract: opts.minEdgePerContract,
      maxCapital: opts.maxCapital,
    });
    if (!fill) {
      skip(direction, "No profitable size after fees");
      continue;
    }

    // Minimums. Polymarket's min order size is denominated in shares (contracts).
    const polyMin = pBook.book.minOrderSize ?? pMarket.orderMinSize;
    if (polyMin != null && fill.poly.contracts.lt(polyMin)) {
      skip(direction, `Polymarket leg ${fill.poly.contracts.toFixed(2)} < min order size ${polyMin}`);
      continue;
    }
    if (fill.contracts.lt(opts.minContracts)) {
      skip(direction, `Only ${fill.contracts.toFixed(2)} contracts (< ${opts.minContracts.toString()})`);
      continue;
    }
    if (fill.kalshi.notional.lt(opts.minLegNotional) || fill.poly.notional.lt(opts.minLegNotional)) {
      skip(direction, `A leg's notional is below $${opts.minLegNotional.toString()}`);
      continue;
    }

    const warnings: string[] = [];
    if (polyFee.warning) warnings.push(polyFee.warning);
    if (days === null) warnings.push("Resolution date unknown; annualized ROI not computed");

    opportunities.push({
      pairId: pair.id,
      direction,
      label: `Kalshi ${legs.kalshiSide.toUpperCase()} + Polymarket "${legs.polyOutcome}"`,
      kalshiTicker: kMarket.ticker,
      kalshiSide: legs.kalshiSide,
      kalshiTitle: kalshiDisplayTitle(kMarket),
      kalshiUrl: kalshiMarketUrl(kMarket),
      polyMarketId: pMarket.id,
      polyOutcome: legs.polyOutcome,
      polyQuestion: pMarket.question,
      polyUrl: polymarketEventUrl(pMarket),
      category: pair.category ?? pMarket.category,
      contracts: fill.contracts.toFixed(2),
      kalshi: legSummary(fill.kalshi),
      poly: legSummary(fill.poly),
      totalCost: fill.totalCost.toFixed(5),
      payout: fill.payout.toFixed(2),
      profit: fill.profit.toFixed(5),
      roi: fill.roi.toFixed(6),
      annualizedRoi: days === null ? null : annualize(fill.roi, days).toFixed(6),
      daysToResolution: days,
      bookFetchedAt: Math.min(books.kalshi.fetchedAt, pBook.fetchedAt),
      bookSkewMs: skew,
      warnings,
    });
  }
  return { opportunities, skips };
}
