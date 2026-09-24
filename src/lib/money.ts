import Decimal from "decimal.js";

// Plenty of precision for prices (4 dp), sizes (2 dp) and products of them.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const CENT = new Decimal("0.01");

/** Round up to the next whole cent (Kalshi fee rounding, conservative). */
export function ceilToCent(x: Decimal): Decimal {
  return x.toDecimalPlaces(2, Decimal.ROUND_CEIL);
}

/** Round down to the given step (e.g. 0.01 contracts). */
export function floorToStep(x: Decimal, step: Decimal): Decimal {
  return x.div(step).floor().mul(step);
}

/** Parse a price/size that may arrive as a string or number. Throws on garbage. */
export function toDec(v: unknown, field = "value"): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) {
    try {
      const d = new Decimal(typeof v === "string" ? v.trim() : v);
      if (d.isFinite()) return d;
    } catch {
      /* fall through */
    }
  }
  throw new Error(`Invalid decimal for ${field}: ${JSON.stringify(v)}`);
}

export function minDec(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

/** A single price level we can buy at: `size` contracts at `price` dollars each. */
export interface Level {
  price: Decimal;
  size: Decimal;
}

/** Asks sorted best-first (ascending price), zero-size levels removed. */
export function sortAsks(levels: Level[]): Level[] {
  return levels.filter((l) => l.size.greaterThan(0)).sort((a, b) => a.price.comparedTo(b.price));
}
