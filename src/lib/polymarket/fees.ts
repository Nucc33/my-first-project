import { Decimal, ONE, ZERO } from "../money";
import type { PolyFeeInfo } from "./parse";

export interface PolyFeeParams {
  /** 0 when fees are disabled. */
  rate: Decimal;
}

export type PolyFeeResolution =
  | { ok: true; params: PolyFeeParams; warning?: string }
  | { ok: false; reason: string };

/**
 * Resolve the taker fee parameters for a market.
 * - feesEnabled false → rate 0.
 * - exponent other than 1 → unsupported (the docs don't say how it applies), so skip the market.
 * - fees enabled but no published rate → conservative fallback rate, with a warning.
 * https://docs.polymarket.com/trading/fees
 */
export function resolvePolyFee(fee: PolyFeeInfo, fallbackRate: Decimal): PolyFeeResolution {
  if (!fee.enabled) return { ok: true, params: { rate: ZERO } };
  if (fee.exponent != null && !new Decimal(fee.exponent).eq(1)) {
    return { ok: false, reason: `Polymarket feeSchedule.exponent=${fee.exponent} is not supported yet` };
  }
  if (fee.rate == null) {
    return {
      ok: true,
      params: { rate: fallbackRate },
      warning: `No feeSchedule.rate published; using fallback ${fallbackRate.toString()}`,
    };
  }
  return { ok: true, params: { rate: new Decimal(fee.rate) } };
}

/**
 * Polymarket taker fee for one fill: C × rate × p × (1 − p), rounded to 5 decimals.
 * We round up (toward higher cost), which is conservative.
 */
export function polyTakerFee(contracts: Decimal, price: Decimal, p: PolyFeeParams): Decimal {
  if (contracts.lte(0) || p.rate.isZero()) return ZERO;
  return contracts.mul(p.rate).mul(price).mul(ONE.minus(price)).toDecimalPlaces(5, Decimal.ROUND_CEIL);
}
