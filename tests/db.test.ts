import { describe, expect, it } from "vitest";
import { deletePair, listPairs, openDb, recordScan, recentScans, upsertPair } from "@/lib/db";
import { pairInputFromJson, pairToJson } from "@/lib/pairs";

describe("pairs storage", () => {
  it("upserts, lists by status, round-trips JSON, and deletes", () => {
    const db = openDb(":memory:");
    const input = pairInputFromJson({
      kalshi_ticker: "KX-1",
      poly_market_id: "55",
      poly_token_for_kalshi_yes: "111",
      poly_token_for_kalshi_no: "222",
      poly_outcome_for_kalshi_yes: "Lakers",
      poly_outcome_for_kalshi_no: "Celtics",
      confirmed_by: "alice",
      notes: "checked OT rules",
    });
    const saved = upsertPair(input, db);
    expect(saved.status).toBe("confirmed");
    // Re-deciding the same pair updates it in place.
    const again = upsertPair({ ...input, status: "rejected", notes: "different source" }, db);
    expect(again.id).toBe(saved.id);
    expect(listPairs("confirmed", db)).toHaveLength(0);
    expect(listPairs("rejected", db)).toHaveLength(1);

    const exported = pairToJson(again);
    expect(exported).toMatchObject({ kalshi_ticker: "KX-1", poly_token_for_kalshi_yes: "111", confirmed_by: "alice", status: "rejected" });
    expect(pairInputFromJson(exported).polyTokenForKalshiNo).toBe("222");
    expect(() => pairInputFromJson({ ...exported, status: "maybe" })).toThrow();

    expect(deletePair(again.id, db)).toBe(true);
    expect(listPairs(undefined, db)).toHaveLength(0);
  });

  it("records scan history", () => {
    const db = openDb(":memory:");
    recordScan(
      { startedAt: "2026-09-24T00:00:00Z", finishedAt: "2026-09-24T00:00:01Z", pairsScanned: 3, opportunities: 1, errors: 0, errorSummary: null },
      [{ pairId: 1, direction: "A", contracts: "10.00", totalCost: "9.5", profit: "0.5", roi: "0.05" }],
      2000,
      db,
    );
    expect(recentScans(5, db)[0]).toMatchObject({ pairsScanned: 3, opportunities: 1 });
  });
});
