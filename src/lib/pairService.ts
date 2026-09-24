import { getPolyMarkets, savePolyMarkets, upsertPair } from "./db";
import { Pair, PairInput, validatePairMapping, withOutcomeLabels } from "./pairs";
import { getPolyMarket } from "./polymarket/client";
import type { PolyMarket } from "./polymarket/parse";

async function polyMarket(id: string): Promise<PolyMarket | null> {
  const cached = getPolyMarkets([id])[0];
  if (cached) return cached;
  const m = await getPolyMarket(id).catch(() => null);
  if (m) savePolyMarkets([m]);
  return m;
}

/**
 * Validate a reviewer's decision and store it. Confirmed pairs must map both Kalshi sides to the
 * two distinct outcome tokens of the Polymarket market.
 */
export async function savePairDecision(input: PairInput): Promise<{ pair?: Pair; errors: string[] }> {
  const poly = input.polyMarketId ? await polyMarket(input.polyMarketId) : null;
  const errors = validatePairMapping(input, poly);
  if (!poly && input.status !== "rejected" && input.polyMarketId) {
    errors.push(`Polymarket market ${input.polyMarketId} not found or not tradable; cannot verify token mapping`);
  }
  if (errors.length) return { errors };
  const pair = upsertPair({ ...withOutcomeLabels(input, poly), category: input.category ?? poly?.category ?? null });
  return { pair, errors: [] };
}
