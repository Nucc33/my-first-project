import { describe, expect, it } from "vitest";
import { walkBooks } from "@/lib/arb";
import { kalshiFeeParamsFor, kalshiTakerFee } from "@/lib/kalshi/fees";
import { parseKalshiOrderbook } from "@/lib/kalshi/parse";
import { Decimal, Level } from "@/lib/money";
import { polyTakerFee, resolvePolyFee } from "@/lib/polymarket/fees";

const D = (x: string | number) => new Decimal(x);
const lv = (price: string, size: string): Level => ({ price: D(price), size: D(size) });
const K = { rate: D("0.07"), multiplier: D(1) };
const POLITICS = { rate: D("0.04") };

describe("fees", () => {
  it("Kalshi fee rounds up to the cent", () => {
    // 0.07 × 100 × 0.42 × 0.58 = 1.7052 → 1.71
    expect(kalshiTakerFee(D(100), D("0.42"), K).toFixed(2)).toBe("1.71");
    // exact cents stay put: 0.07 × 100 × 0.5 × 0.5 = 1.75
    expect(kalshiTakerFee(D(100), D("0.5"), K).toFixed(2)).toBe("1.75");
    // tiny fills still pay a cent
    expect(kalshiTakerFee(D(1), D("0.01"), K).toFixed(2)).toBe("0.01");
  });

  it("Polymarket fee is C × rate × p × (1 − p) to 5 dp", () => {
    expect(polyTakerFee(D(100), D("0.53"), POLITICS).toFixed(5)).toBe("0.99640");
  });

  it("per-series Kalshi multipliers", () => {
    const params = kalshiFeeParamsFor("kxfed", { rate: D("0.07"), multipliers: { KXFED: D(0) } });
    expect(params.multiplier.toString()).toBe("0");
    expect(kalshiFeeParamsFor("OTHER", { rate: D("0.07"), multipliers: { KXFED: D(0) } }).multiplier.toString()).toBe("1");
  });

  it("flags Polymarket fee exponents other than 1", () => {
    const r = resolvePolyFee({ enabled: true, rate: "0.04", exponent: "2" }, D("0.07"));
    expect(r.ok).toBe(false);
    expect(resolvePolyFee({ enabled: true, rate: "0.04", exponent: "1" }, D("0.07")).ok).toBe(true);
  });
});

describe("walkBooks", () => {
  it("worked example: Kalshi YES 0.42 + Polymarket NO 0.53, 100 contracts", () => {
    // Kalshi YES best ask $0.42 comes from a NO bid at $0.58.
    const kBook = parseKalshiOrderbook({ orderbook_fp: { yes_dollars: [], no_dollars: [["0.5800", "100.00"]] } });
    expect(kBook.yesAsks[0].price.toFixed(2)).toBe("0.42");

    const fill = walkBooks({
      kalshiAsks: kBook.yesAsks,
      polyAsks: [lv("0.53", "100")],
      kalshiFee: K,
      polyFee: POLITICS,
    })!;
    expect(fill).not.toBeNull();
    expect(fill.contracts.toFixed(2)).toBe("100.00");
    expect(fill.kalshi.fees.toFixed(2)).toBe("1.71");
    expect(fill.poly.fees.toFixed(5)).toBe("0.99640");
    expect(fill.totalCost.toFixed(4)).toBe("97.7064");
    expect(fill.payout.toFixed(2)).toBe("100.00");
    expect(fill.profit.toFixed(4)).toBe("2.2936");
    expect(fill.roi.mul(100).toFixed(2)).toBe("2.35");
  });

  it("no arbitrage when prices sum to ≥ $1 before fees", () => {
    expect(walkBooks({ kalshiAsks: [lv("0.50", "100")], polyAsks: [lv("0.50", "100")], kalshiFee: K, polyFee: POLITICS })).toBeNull();
    expect(walkBooks({ kalshiAsks: [lv("0.55", "100")], polyAsks: [lv("0.50", "100")], kalshiFee: K, polyFee: POLITICS })).toBeNull();
    // Even with zero fees, exactly $1 is not a profit.
    expect(walkBooks({ kalshiAsks: [lv("0.50", "100")], polyAsks: [lv("0.50", "100")], kalshiFee: { rate: D(0), multiplier: D(1) }, polyFee: { rate: D(0) } })).toBeNull();
  });

  it("fees wipe out a thin edge (0.49 + 0.50)", () => {
    // Pre-fee edge is $1.00 on 100 contracts; fees are 1.75 + 1.00.
    expect(walkBooks({ kalshiAsks: [lv("0.49", "100")], polyAsks: [lv("0.50", "100")], kalshiFee: K, polyFee: POLITICS })).toBeNull();
    // Without fees the same books are profitable.
    const free = walkBooks({ kalshiAsks: [lv("0.49", "100")], polyAsks: [lv("0.50", "100")], kalshiFee: { rate: D("0.07"), multiplier: D(0) }, polyFee: { rate: D(0) } })!;
    expect(free.profit.toFixed(2)).toBe("1.00");
  });

  it("multi-level walk stops at the first unprofitable chunk", () => {
    const fill = walkBooks({
      // unsorted on purpose
      kalshiAsks: [lv("0.45", "100"), lv("0.40", "50")],
      polyAsks: [lv("0.50", "80"), lv("0.60", "500")],
      kalshiFee: K,
      polyFee: POLITICS,
    })!;
    // Chunks: 50 @ (0.40, 0.50) ✓, 30 @ (0.45, 0.50) ✓, then (0.45, 0.60) sums to 1.05 ✗.
    expect(fill.contracts.toFixed(2)).toBe("80.00");
    expect(fill.kalshi.levels.map((l) => [l.price.toFixed(2), l.contracts.toFixed(0)])).toEqual([
      ["0.40", "50"],
      ["0.45", "30"],
    ]);
    expect(fill.poly.levels).toHaveLength(1);
    // Kalshi fees per level: ceil(0.07×50×0.4×0.6=0.84)=0.84, ceil(0.07×30×0.45×0.55=0.51975)=0.52
    expect(fill.kalshi.fees.toFixed(2)).toBe("1.36");
    // Poly fee on aggregated 80 @ 0.50: 80 × 0.04 × 0.25 = 0.8
    expect(fill.poly.fees.toFixed(5)).toBe("0.80000");
    // Cost = 20 + 13.5 + 40 + 1.36 + 0.8 = 75.66
    expect(fill.totalCost.toFixed(2)).toBe("75.66");
    expect(fill.profit.toFixed(2)).toBe("4.34");
  });

  it("Kalshi fees recomputed from the aggregated fill per level", () => {
    // Two Poly levels split the Kalshi level into two chunks; the Kalshi fee must be charged once on 100.
    const fill = walkBooks({
      kalshiAsks: [lv("0.42", "100")],
      polyAsks: [lv("0.52", "50"), lv("0.53", "50")],
      kalshiFee: K,
      polyFee: POLITICS,
    })!;
    expect(fill.kalshi.levels).toHaveLength(1);
    expect(fill.kalshi.fees.toFixed(2)).toBe("1.71"); // not 0.86 + 0.86
  });

  it("empty books produce nothing", () => {
    expect(walkBooks({ kalshiAsks: [], polyAsks: [lv("0.3", "10")], kalshiFee: K, polyFee: POLITICS })).toBeNull();
    expect(walkBooks({ kalshiAsks: [lv("0.3", "10")], polyAsks: [], kalshiFee: K, polyFee: POLITICS })).toBeNull();
    const empty = parseKalshiOrderbook({ orderbook_fp: { yes_dollars: [], no_dollars: [] } });
    expect(empty.yesAsks).toHaveLength(0);
    expect(empty.noAsks).toHaveLength(0);
  });

  it("Polymarket market with fees disabled", () => {
    const fees = resolvePolyFee({ enabled: false, rate: "0.04", exponent: "1" }, D("0.07"));
    expect(fees.ok).toBe(true);
    const fill = walkBooks({ kalshiAsks: [lv("0.42", "100")], polyAsks: [lv("0.53", "100")], kalshiFee: K, polyFee: (fees as { ok: true; params: { rate: Decimal } }).params })!;
    expect(fill.poly.fees.toFixed(5)).toBe("0.00000");
    expect(fill.totalCost.toFixed(2)).toBe("96.71");
  });

  it("Kalshi series with multiplier 0", () => {
    const kFee = kalshiFeeParamsFor("KXZERO", { rate: D("0.07"), multipliers: { KXZERO: D(0) } });
    const fill = walkBooks({ kalshiAsks: [lv("0.42", "100")], polyAsks: [lv("0.53", "100")], kalshiFee: kFee, polyFee: POLITICS })!;
    expect(fill.kalshi.fees.toFixed(2)).toBe("0.00");
    expect(fill.totalCost.toFixed(4)).toBe("95.9964");
  });

  it("respects max capital", () => {
    const fill = walkBooks({
      kalshiAsks: [lv("0.42", "100")],
      polyAsks: [lv("0.53", "100")],
      kalshiFee: K,
      polyFee: POLITICS,
      maxCapital: D(50),
    })!;
    expect(fill.totalCost.lte(50)).toBe(true);
    // One more cent of contracts must not fit.
    const more = walkBooks({
      kalshiAsks: [lv("0.42", fill.contracts.plus("0.01").toString())],
      polyAsks: [lv("0.53", "100")],
      kalshiFee: K,
      polyFee: POLITICS,
    })!;
    expect(more.totalCost.gt(50)).toBe(true);
  });

  it("minimum edge per contract", () => {
    // Worked example edge is ~2.29¢/contract; require 3¢.
    expect(
      walkBooks({ kalshiAsks: [lv("0.42", "100")], polyAsks: [lv("0.53", "100")], kalshiFee: K, polyFee: POLITICS, minEdgePerContract: D("0.03") }),
    ).toBeNull();
  });

  it("handles sub-cent dust on a level", () => {
    const fill = walkBooks({
      kalshiAsks: [lv("0.30", "10")],
      polyAsks: [lv("0.40", "0.005"), lv("0.41", "20")],
      kalshiFee: K,
      polyFee: POLITICS,
    })!;
    expect(fill.contracts.toFixed(2)).toBe("10.00");
    expect(fill.poly.levels.map((l) => l.price.toFixed(2))).toEqual(["0.41"]);
  });
});
