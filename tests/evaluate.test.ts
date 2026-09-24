import { describe, expect, it } from "vitest";
import kMarkets from "./fixtures/kalshi-markets.json";
import pMarkets from "./fixtures/poly-markets.json";
import { evaluatePair, EvalOptions, PairBooks } from "@/lib/evaluate";
import { parseKalshiMarket, parseKalshiOrderbook } from "@/lib/kalshi/parse";
import { Decimal } from "@/lib/money";
import { legsForDirection, Pair, validatePairMapping } from "@/lib/pairs";
import { parsePolyBook, parsePolyMarket, PolyRawMarket } from "@/lib/polymarket/parse";

const kMarket = { ...parseKalshiMarket(kMarkets.markets[0] as never)!, title: "Will the Lakers beat the Celtics?", yesSubTitle: "" };
const pMarket = parsePolyMarket(pMarkets.markets[0] as PolyRawMarket)!;

// Non-"Yes/No" mapping: Kalshi YES ⇔ "Lakers" (token 111), Kalshi NO ⇔ "Celtics" (token 222).
const pair: Pair = {
  id: 7,
  kalshiTicker: kMarket.ticker,
  polyMarketId: pMarket.id,
  polyTokenForKalshiYes: "111",
  polyTokenForKalshiNo: "222",
  polyOutcomeForKalshiYes: "Lakers",
  polyOutcomeForKalshiNo: "Celtics",
  status: "confirmed",
  category: "Sports",
  confirmedBy: "tester",
  confirmedAt: "2026-09-24T00:00:00Z",
  notes: "",
};

const opts: EvalOptions = {
  stalenessMs: 5000,
  minEdgePerContract: new Decimal(0),
  minLegNotional: new Decimal(1),
  minContracts: new Decimal(1),
  kalshiTakerFeeRate: new Decimal("0.07"),
  kalshiFeeMultipliers: {},
  kalshiHonorFeeWaiver: false,
  polyFallbackFeeRate: new Decimal("0.07"),
  maxCapital: null,
  now: Date.parse("2026-09-24T00:00:00Z"),
};

const T = 1_790_000_000_000;
function books(opts: { kalshiAt?: number; celticsAsks?: Array<{ price: string; size: string }>; lakersAsks?: Array<{ price: string; size: string }>; polyAt?: number } = {}): PairBooks {
  const kalshi = parseKalshiOrderbook({
    orderbook_fp: { yes_dollars: [["0.38", "25"], ["0.40", "10.5"]], no_dollars: [["0.55", "40"], ["0.58", "100"]] },
  });
  const mk = (id: string, asks: Array<{ price: string; size: string }>) => ({
    book: parsePolyBook({ asset_id: id, market: "0xabc", bids: [], asks, min_order_size: "5" }),
    fetchedAt: opts.polyAt ?? T,
  });
  return {
    kalshi: { book: kalshi, fetchedAt: opts.kalshiAt ?? T },
    poly: new Map([
      ["222", mk("222", opts.celticsAsks ?? [{ price: "0.53", size: "80" }, { price: "0.55", size: "50" }])],
      ["111", mk("111", opts.lakersAsks ?? [{ price: "0.50", size: "100" }])],
    ]),
  };
}

describe("direction mapping", () => {
  it("A buys Kalshi YES + the outcome paying on Kalshi NO; B the reverse", () => {
    expect(legsForDirection(pair, "A")).toEqual({ direction: "A", kalshiSide: "yes", polyTokenId: "222", polyOutcome: "Celtics" });
    expect(legsForDirection(pair, "B")).toEqual({ direction: "B", kalshiSide: "no", polyTokenId: "111", polyOutcome: "Lakers" });
  });

  it("validates tokens against the market's outcomes", () => {
    const base = { ...pair, confirmedBy: "x" };
    expect(validatePairMapping(base, pMarket)).toEqual([]);
    expect(validatePairMapping({ ...base, polyTokenForKalshiNo: "111" }, pMarket)).toContain("Kalshi YES and NO must map to different Polymarket outcomes");
    expect(validatePairMapping({ ...base, polyTokenForKalshiNo: "999" }, pMarket).join()).toMatch(/not an outcome/);
    expect(validatePairMapping({ ...base, confirmedBy: " " }, pMarket)).toContain("confirmedBy is required");
  });
});

describe("evaluatePair", () => {
  it("finds direction A with a non-Yes/No outcome and walks multiple levels", () => {
    const r = evaluatePair(pair, kMarket, pMarket, books(), opts);
    expect(r.opportunities).toHaveLength(1);
    const o = r.opportunities[0];
    expect(o.direction).toBe("A");
    expect(o.polyOutcome).toBe("Celtics");
    expect(o.kalshiSide).toBe("yes");
    // 80 @ (0.42 + 0.53) then 20 @ (0.42 + 0.55); next chunk (0.45 + 0.55) = 1.00 stops the walk.
    expect(o.contracts).toBe("100.00");
    expect(o.kalshi.levelsConsumed).toBe(1);
    expect(o.poly.levelsConsumed).toBe(2);
    expect(o.kalshi.fees).toBe("1.71000"); // ceil(0.07 × 100 × 0.42 × 0.58)
    expect(o.poly.fees).toBe("1.24390"); // 0.9964 + 0.2475 (rate 0.05)
    expect(o.totalCost).toBe("98.35390");
    expect(o.profit).toBe("1.64610");
    expect(o.daysToResolution).toBeGreaterThan(80);
    expect(o.annualizedRoi).not.toBeNull();
    expect(o.polyUrl).toBe("https://polymarket.com/event/nba-lal-bos-2026-10-30");
    // B: Kalshi NO 0.60 + Lakers 0.50 > $1
    expect(r.skips).toEqual([{ pairId: 7, direction: "B", reason: "No profitable size after fees" }]);
  });

  it("skips stale books", () => {
    const r = evaluatePair(pair, kMarket, pMarket, books({ polyAt: T + 6000 }), opts);
    expect(r.opportunities).toHaveLength(0);
    expect(r.skips[0].reason).toMatch(/apart/);
  });

  it("skips empty books", () => {
    const r = evaluatePair(pair, kMarket, pMarket, books({ celticsAsks: [] }), opts);
    expect(r.opportunities).toHaveLength(0);
    expect(r.skips.find((s) => s.direction === "A")!.reason).toMatch(/no asks/);
    const noKalshi = evaluatePair(pair, kMarket, pMarket, { ...books(), kalshi: null }, opts);
    expect(noKalshi.skips[0].reason).toMatch(/Kalshi book/);
  });

  it("enforces the Polymarket minimum order size", () => {
    const r = evaluatePair(pair, kMarket, pMarket, books({ celticsAsks: [{ price: "0.53", size: "3" }] }), opts);
    expect(r.opportunities).toHaveLength(0);
    expect(r.skips.find((s) => s.direction === "A")!.reason).toMatch(/min order size/);
  });

  it("skips markets with an unsupported fee exponent", () => {
    const r = evaluatePair(pair, kMarket, { ...pMarket, fee: { enabled: true, rate: "0.05", exponent: "2" } }, books(), opts);
    expect(r.opportunities).toHaveLength(0);
    expect(r.skips[0].reason).toMatch(/exponent/);
  });

  it("zero Kalshi fee multiplier and disabled Polymarket fees", () => {
    const r = evaluatePair(
      pair,
      kMarket,
      { ...pMarket, fee: { enabled: false, rate: "0.05", exponent: "1" } },
      books(),
      { ...opts, kalshiFeeMultipliers: { KXFEDDECISION: new Decimal(0) } },
    );
    const o = r.opportunities.find((x) => x.direction === "A")!;
    expect(o.kalshi.fees).toBe("0.00000");
    expect(o.poly.fees).toBe("0.00000");
    // Fee-free: 80 @ 0.95, 20 @ 0.97; (0.45 + 0.55) = 1.00 still isn't profitable.
    expect(o.totalCost).toBe("95.40000");
  });

  it("applies max capital", () => {
    const r = evaluatePair(pair, kMarket, pMarket, books(), { ...opts, maxCapital: new Decimal(20) });
    const o = r.opportunities[0];
    expect(Number(o.totalCost)).toBeLessThanOrEqual(20);
    expect(Number(o.contracts)).toBeGreaterThan(19);
  });
});
