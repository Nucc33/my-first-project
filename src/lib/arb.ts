import { kalshiTakerFee, KalshiFeeParams } from "./kalshi/fees";
import { CENT, Decimal, floorToStep, Level, minDec, ONE, ZERO } from "./money";
import { polyTakerFee, PolyFeeParams } from "./polymarket/fees";

/**
 * Direction A: buy YES on Kalshi + buy the Polymarket outcome that pays when Kalshi resolves NO.
 * Direction B: buy NO on Kalshi + buy the Polymarket outcome that pays when Kalshi resolves YES.
 * Exactly one leg pays $1.00 per contract at settlement (if the pair truly resolves identically).
 */
export type Direction = "A" | "B";

export interface ArbInput {
  /** Kalshi asks for the side we buy, any order. */
  kalshiAsks: Level[];
  /** Polymarket asks for the opposite outcome token, any order. */
  polyAsks: Level[];
  kalshiFee: KalshiFeeParams;
  polyFee: PolyFeeParams;
  /** Required edge per contract in dollars; a chunk is taken only if cost < q × (1 − minEdge). */
  minEdgePerContract?: Decimal;
  /** Stop once total cost would exceed this. null/undefined = unlimited. */
  maxCapital?: Decimal | null;
  /** Smallest tradable contract increment (Kalshi allows 0.01). */
  sizeStep?: Decimal;
}

export interface LevelFill {
  price: Decimal;
  contracts: Decimal;
  fee: Decimal;
}

export interface LegFill {
  contracts: Decimal;
  /** Σ price × contracts (before fees). */
  notional: Decimal;
  fees: Decimal;
  avgPrice: Decimal;
  levels: LevelFill[];
}

export interface ArbFill {
  contracts: Decimal;
  kalshi: LegFill;
  poly: LegFill;
  totalCost: Decimal;
  payout: Decimal;
  profit: Decimal;
  /** profit / totalCost */
  roi: Decimal;
}

function validAsks(levels: Level[]): Level[] {
  return levels
    .filter((l) => l.size.gt(0) && l.price.gt(0) && l.price.lt(1))
    .sort((a, b) => a.price.comparedTo(b.price));
}

/**
 * Walk both ask books together, level by level. At each step take
 * q = min(remaining at Kalshi level, remaining at Polymarket level) and keep the chunk only if
 * its marginal cost (prices + incremental fees) is below q × (1 − minEdge). Stop at the first
 * unprofitable chunk, when a book runs out, or at the capital limit.
 *
 * Fees are charged per price level on the aggregated fill at that level (Kalshi: ceil to the cent;
 * Polymarket: 5 dp, rounded up). The marginal fee of a chunk is fee(filled + q) − fee(filled), so
 * the walk's decisions agree exactly with the recomputed totals.
 *
 * Returns null when not even one chunk is profitable.
 */
export function walkBooks(input: ArbInput): ArbFill | null {
  const kAsks = validAsks(input.kalshiAsks);
  const pAsks = validAsks(input.polyAsks);
  const minEdge = input.minEdgePerContract ?? ZERO;
  const step = input.sizeStep ?? CENT;
  const maxCapital = input.maxCapital ?? null;

  const kFilled: Decimal[] = kAsks.map(() => ZERO);
  const pFilled: Decimal[] = pAsks.map(() => ZERO);
  let i = 0;
  let j = 0;
  let spent = ZERO;

  const chunkCost = (q: Decimal): Decimal => {
    const pK = kAsks[i].price;
    const pP = pAsks[j].price;
    const kFee = kalshiTakerFee(kFilled[i].plus(q), pK, input.kalshiFee).minus(kalshiTakerFee(kFilled[i], pK, input.kalshiFee));
    const pFee = polyTakerFee(pFilled[j].plus(q), pP, input.polyFee).minus(polyTakerFee(pFilled[j], pP, input.polyFee));
    return q.mul(pK).plus(q.mul(pP)).plus(kFee).plus(pFee);
  };
  const profitable = (q: Decimal, cost: Decimal) => cost.lt(q.mul(ONE.minus(minEdge)));

  while (i < kAsks.length && j < pAsks.length) {
    const remK = kAsks[i].size.minus(kFilled[i]);
    const remP = pAsks[j].size.minus(pFilled[j]);
    let q = floorToStep(minDec(remK, remP), step);
    if (q.isZero()) {
      // Sub-step dust left on a level: skip past it.
      if (remK.lte(remP)) i++;
      else j++;
      continue;
    }

    let cost = chunkCost(q);
    if (!profitable(q, cost)) break;

    let capped = false;
    if (maxCapital && spent.plus(cost).gt(maxCapital)) {
      // Largest multiple of `step` that still fits the budget (cost is monotone in q).
      let lo = 0;
      let hi = q.div(step).toNumber();
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (spent.plus(chunkCost(step.mul(mid))).lte(maxCapital)) lo = mid;
        else hi = mid - 1;
      }
      q = step.mul(lo);
      if (q.isZero()) break;
      cost = chunkCost(q);
      if (!profitable(q, cost)) break;
      capped = true;
    }

    kFilled[i] = kFilled[i].plus(q);
    pFilled[j] = pFilled[j].plus(q);
    spent = spent.plus(cost);
    if (capped) break;
    if (kFilled[i].gte(kAsks[i].size)) i++;
    if (pFilled[j].gte(pAsks[j].size)) j++;
  }

  const kalshi = summarizeLeg(kAsks, kFilled, (c, p) => kalshiTakerFee(c, p, input.kalshiFee));
  const poly = summarizeLeg(pAsks, pFilled, (c, p) => polyTakerFee(c, p, input.polyFee));
  if (kalshi.contracts.isZero()) return null;

  const contracts = kalshi.contracts;
  const totalCost = kalshi.notional.plus(kalshi.fees).plus(poly.notional).plus(poly.fees);
  const payout = contracts.mul(ONE);
  const profit = payout.minus(totalCost);
  return { contracts, kalshi, poly, totalCost, payout, profit, roi: profit.div(totalCost) };
}

function summarizeLeg(asks: Level[], filled: Decimal[], fee: (c: Decimal, p: Decimal) => Decimal): LegFill {
  const levels: LevelFill[] = [];
  let contracts = ZERO;
  let notional = ZERO;
  let fees = ZERO;
  asks.forEach((lvl, idx) => {
    const c = filled[idx];
    if (c.isZero()) return;
    const f = fee(c, lvl.price);
    levels.push({ price: lvl.price, contracts: c, fee: f });
    contracts = contracts.plus(c);
    notional = notional.plus(c.mul(lvl.price));
    fees = fees.plus(f);
  });
  return { contracts, notional, fees, avgPrice: contracts.isZero() ? ZERO : notional.div(contracts), levels };
}

/** Simple (non-compounding) annualization: roi × 365 / days. Days are floored at 1 to avoid blow-ups. */
export function annualize(roi: Decimal, days: number): Decimal {
  return roi.mul(365).div(Math.max(days, 1));
}

export function daysUntil(isoDates: Array<string | null | undefined>, now = Date.now()): number | null {
  const ts = isoDates.map((d) => (d ? Date.parse(d) : NaN)).filter((t) => Number.isFinite(t));
  if (ts.length === 0) return null;
  return (Math.max(...ts) - now) / 86_400_000;
}
