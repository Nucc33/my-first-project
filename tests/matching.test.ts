import { describe, expect, it } from "vitest";
import type { KalshiMarket } from "@/lib/kalshi/parse";
import { generateCandidates, pairKey } from "@/lib/matching/candidates";
import { normalizeTitle, normalizeTokens } from "@/lib/matching/normalize";
import type { PolyMarket } from "@/lib/polymarket/parse";

const k = (ticker: string, title: string, close: string, yesSub = ""): KalshiMarket => ({
  ticker,
  eventTicker: ticker.split("-").slice(0, 2).join("-"),
  seriesTicker: ticker.split("-")[0],
  title,
  yesSubTitle: yesSub,
  noSubTitle: "",
  rulesPrimary: "",
  rulesSecondary: "",
  closeTime: close,
  expectedExpirationTime: null,
  status: "active",
  yesAsk: null,
  noAsk: null,
  priceRanges: null,
  feeWaiverExpirationTime: null,
  category: null,
});
const p = (id: string, question: string, end: string): PolyMarket => ({
  id,
  slug: id,
  eventSlug: id,
  question,
  conditionId: "",
  description: "",
  resolutionSource: "",
  endDateIso: end,
  negRisk: false,
  tickSize: null,
  orderMinSize: null,
  outcomes: [
    { label: "Yes", tokenId: `${id}-y`, price: null },
    { label: "No", tokenId: `${id}-n`, price: null },
  ],
  fee: { enabled: false, rate: null, exponent: null },
  category: null,
});

describe("normalize", () => {
  it("lowercases, strips punctuation, expands abbreviations and months", () => {
    expect(normalizeTitle("Will the Fed cut rates in Dec?")).toBe("federal reserve cut rates december");
    expect(normalizeTitle("BTC above $100k on Jan 1, 2027?")).toBe("bitcoin above 100000 january 1 2027");
    expect(normalizeTokens("CPI > 3.5% in Q4")).toEqual(["inflation", "3.5", "percent", "fourth", "quarter"]);
  });

  it("treats Object.prototype member names as plain words", () => {
    expect(normalizeTokens("F1 Constructor champion toString valueOf __proto__ hasOwnProperty")).toEqual([
      "f1", "constructor", "champion", "tostring", "valueof", "proto", "hasownproperty",
    ]);
  });
});

describe("generateCandidates", () => {
  const kalshi = [
    k("KXFED-26DEC-CUT", "Will the Fed cut rates in December 2026?", "2026-12-16T19:00:00Z"),
    k("KXBTC-27JAN-100K", "Bitcoin above $100k on Jan 1, 2027?", "2027-01-01T00:00:00Z"),
    k("KXNBA-26OCT-LAL", "Lakers vs Celtics winner", "2026-10-30T23:00:00Z", "Lakers"),
  ];
  const poly = [
    p("1", "Fed cuts rates in December 2026?", "2026-12-17"),
    p("2", "Will BTC be above $100,000 on January 1, 2027?", "2027-01-01"),
    p("3", "Will the Fed cut rates in March 2027?", "2027-03-18"),
  ];
  const opts = { maxCloseDaysApart: 3, minScore: 0.3, limit: 50 };

  it("ranks true matches and rejects far-apart close dates", () => {
    const c = generateCandidates(kalshi, poly, opts);
    const keys = c.map((x) => pairKey(x.kalshiTicker, x.polyMarketId));
    expect(keys).toContain("KXFED-26DEC-CUT|1");
    expect(keys).toContain("KXBTC-27JAN-100K|2");
    expect(keys).not.toContain("KXFED-26DEC-CUT|3"); // ~92 days apart
  });

  it("can ignore dates when forced", () => {
    const c = generateCandidates(kalshi, poly, { ...opts, ignoreDates: true });
    expect(c.map((x) => pairKey(x.kalshiTicker, x.polyMarketId))).toContain("KXFED-26DEC-CUT|3");
  });

  it("excludes reviewed pairs", () => {
    const c = generateCandidates(kalshi, poly, { ...opts, exclude: new Set(["KXFED-26DEC-CUT|1"]) });
    expect(c.map((x) => pairKey(x.kalshiTicker, x.polyMarketId))).not.toContain("KXFED-26DEC-CUT|1");
  });
});
