import { describe, expect, it } from "vitest";
import kMarkets from "./fixtures/kalshi-markets.json";
import kBook from "./fixtures/kalshi-orderbook.json";
import pMarkets from "./fixtures/poly-markets.json";
import pBook from "./fixtures/poly-book.json";
import { parseKalshiMarket, parseKalshiOrderbook, seriesFromEventTicker } from "@/lib/kalshi/parse";
import { kalshiMarketUrl, polymarketEventUrl } from "@/lib/links";
import { parsePolyBook, parsePolyMarket, PolyRawMarket } from "@/lib/polymarket/parse";
import { unwrapKeysetPage } from "@/lib/polymarket/client";
import { parseMultipliers } from "@/lib/config";

describe("Kalshi parsing", () => {
  it("keeps binary markets and derives the series ticker", () => {
    const parsed = kMarkets.markets.map((m) => parseKalshiMarket(m as never));
    expect(parsed[1]).toBeNull(); // non-binary
    const m = parsed[0]!;
    expect(m.seriesTicker).toBe("KXFEDDECISION");
    expect(m.rulesPrimary).toMatch(/Federal Reserve/);
    expect(m.yesAsk).toBe("0.4200");
    expect(seriesFromEventTicker("kxhighny-26sep25")).toBe("KXHIGHNY");
    expect(kalshiMarketUrl(m)).toBe("https://kalshi.com/markets/kxfeddecision");
  });

  it("derives asks from the opposite side's bids, best first", () => {
    const b = parseKalshiOrderbook(kBook);
    // YES asks = 1 − NO bids: 0.58 → 0.42, 0.55 → 0.45
    expect(b.yesAsks.map((l) => [l.price.toFixed(2), l.size.toFixed(2)])).toEqual([
      ["0.42", "100.00"],
      ["0.45", "40.00"],
    ]);
    // NO asks = 1 − YES bids: 0.40 → 0.60, 0.38 → 0.62
    expect(b.noAsks.map((l) => [l.price.toFixed(2), l.size.toFixed(2)])).toEqual([
      ["0.60", "10.50"],
      ["0.62", "25.00"],
    ]);
  });

  it("rejects malformed books", () => {
    expect(() => parseKalshiOrderbook({})).toThrow();
    expect(() => parseKalshiOrderbook({ orderbook_fp: { yes_dollars: [["x", "1"]] } })).toThrow();
  });
});

describe("Polymarket parsing", () => {
  it("parses JSON-encoded arrays and keeps outcome labels in order", () => {
    const { markets, next } = unwrapKeysetPage(pMarkets);
    expect(next).toBeNull();
    const m = parsePolyMarket(markets[0])!;
    expect(m.outcomes).toEqual([
      { label: "Lakers", tokenId: "111", price: "0.45" },
      { label: "Celtics", tokenId: "222", price: "0.55" },
    ]);
    expect(m.fee).toEqual({ enabled: true, rate: "0.05", exponent: "1" });
    expect(m.orderMinSize).toBe("5");
    expect(polymarketEventUrl(m)).toBe("https://polymarket.com/event/nba-lal-bos-2026-10-30");
  });

  it("drops non-tradable markets", () => {
    expect(parsePolyMarket(pMarkets.markets[1] as PolyRawMarket)).toBeNull();
    const base = pMarkets.markets[0] as PolyRawMarket;
    expect(parsePolyMarket({ ...base, acceptingOrders: false })).toBeNull();
    expect(parsePolyMarket({ ...base, enableOrderBook: false })).toBeNull();
    expect(parsePolyMarket({ ...base, active: false })).toBeNull();
  });

  it("accepts a bare-array keyset page", () => {
    expect(unwrapKeysetPage([{ id: 1 }]).markets).toHaveLength(1);
    expect(unwrapKeysetPage({ data: [{ id: 1 }], next_cursor: "abc" }).next).toBe("abc");
  });

  it("sorts book sides explicitly", () => {
    const b = parsePolyBook(pBook);
    expect(b.asks.map((l) => l.price.toFixed(2))).toEqual(["0.53", "0.55", "0.60"]);
    expect(b.bids.map((l) => l.price.toFixed(2))).toEqual(["0.44", "0.40"]);
    expect(b.minOrderSize).toBe("5");
  });
});

describe("config", () => {
  it("parses Kalshi fee multiplier overrides", () => {
    const m = parseMultipliers("kxhighny=0.5, KXFED=0");
    expect(m.KXHIGHNY.toString()).toBe("0.5");
    expect(m.KXFED.toString()).toBe("0");
    expect(() => parseMultipliers("BAD")).toThrow();
  });
});
