import { ceilToCent, Decimal, ONE, ZERO } from "../money";

export interface KalshiFeeParams {
  /** Base taker rate, 0.07 per Kalshi's fee schedule. */
  rate: Decimal;
  /** Series multiplier (1 by default, 0 for fee-free series). */
  multiplier: Decimal;
}

/**
 * Kalshi taker fee for one fill of `contracts` at `price`:
 *   ceil_to_cent(rate × multiplier × C × P × (1 − P))
 * Kalshi rounds more precisely for some account types; whole-cent ceiling is conservative.
 * https://kalshi.com/fee-schedule
 */
export function kalshiTakerFee(contracts: Decimal, price: Decimal, p: KalshiFeeParams): Decimal {
  if (contracts.lte(0) || p.multiplier.isZero() || p.rate.isZero()) return ZERO;
  return ceilToCent(p.rate.mul(p.multiplier).mul(contracts).mul(price).mul(ONE.minus(price)));
}

export function kalshiFeeParamsFor(
  seriesTicker: string,
  opts: {
    rate: Decimal;
    multipliers: Record<string, Decimal>;
    honorWaiver?: boolean;
    feeWaiverExpirationTime?: string | null;
    now?: Date;
  },
): KalshiFeeParams {
  let multiplier = opts.multipliers[seriesTicker.toUpperCase()] ?? ONE;
  if (opts.honorWaiver && opts.feeWaiverExpirationTime) {
    const until = Date.parse(opts.feeWaiverExpirationTime);
    if (Number.isFinite(until) && until > (opts.now ?? new Date()).getTime()) multiplier = ZERO;
  }
  return { rate: opts.rate, multiplier };
}
