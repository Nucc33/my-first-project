import { badRequest, decParam, ensureStarted, json, serverError } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { listPairs } from "@/lib/db";
import { Decimal } from "@/lib/money";
import { computeOpportunities, evalOptions, state } from "@/lib/scanner";

export const dynamic = "force-dynamic";

/**
 * GET /api/opportunities?maxCapital=500&minProfit=1&minRoi=0.5&category=Politics
 * Re-evaluates the latest scanned books with the caller's capital limit (no extra venue requests).
 * minRoi is in percent.
 */
export async function GET(req: Request) {
  ensureStarted();
  const u = new URL(req.url);
  const maxCapital = decParam(u.searchParams.get("maxCapital"));
  const minProfit = decParam(u.searchParams.get("minProfit"));
  const minRoi = decParam(u.searchParams.get("minRoi"));
  if (maxCapital === null || minProfit === null || minRoi === null) return badRequest("maxCapital, minProfit and minRoi must be non-negative numbers");
  const category = u.searchParams.get("category")?.trim() || null;
  try {
    const cap = maxCapital === undefined ? getConfig().defaultMaxCapital : new Decimal(maxCapital);
    const { opportunities, skips } = await computeOpportunities(evalOptions(cap.gt(0) ? cap : null));
    const pairs = listPairs("confirmed");
    const categories = [...new Set(opportunities.map((o) => o.category).concat(pairs.map((p) => p.category)).filter(Boolean))].sort();
    const filtered = opportunities.filter(
      (o) =>
        (minProfit === undefined || new Decimal(o.profit).gte(minProfit)) &&
        (minRoi === undefined || new Decimal(o.roi).mul(100).gte(minRoi)) &&
        (!category || o.category === category),
    );
    return json({
      opportunities: filtered,
      skips,
      categories,
      confirmedPairs: pairs.length,
      lastScanAt: state.lastScanAt,
      lastScanDurationMs: state.lastScanDurationMs,
      scanning: state.scanning,
      serverTime: Date.now(),
      maxCapital: cap.toString(),
    });
  } catch (err) {
    return serverError(err);
  }
}
