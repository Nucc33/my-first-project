import { yieldToEventLoop } from "../async";
import { kalshiDisplayTitle, KalshiMarket } from "../kalshi/parse";
import type { PolyMarket } from "../polymarket/parse";
import { normalizeTokens } from "./normalize";

export interface Candidate {
  kalshiTicker: string;
  polyMarketId: string;
  score: number;
  textScore: number;
  dateScore: number;
  closeDaysApart: number | null;
  kalshiTitle: string;
  polyQuestion: string;
}

export interface CandidateOptions {
  maxCloseDaysApart: number;
  /** Keep pairs whose close dates are too far apart (still scored). */
  ignoreDates?: boolean;
  minScore: number;
  limit: number;
  /** "kalshiTicker|polyMarketId" keys already reviewed (confirmed or rejected). */
  exclude?: Set<string>;
  /** Candidates per Polymarket market considered before global ranking. */
  perPolyMarket?: number;
}

export const pairKey = (kalshiTicker: string, polyMarketId: string) => `${kalshiTicker}|${polyMarketId}`;

/** Kalshi resolution date used for matching and annualization. */
export function kalshiResolutionDate(m: KalshiMarket): string | null {
  return m.expectedExpirationTime ?? m.closeTime;
}

function daysApart(a: string | null, b: string | null): number | null {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * IDF-weighted token-set similarity: the mean of weighted Jaccard (penalises extra tokens on
 * either side) and weighted overlap (rewards one title containing the other).
 */
export function tokenSetSimilarity(a: Set<string>, b: Set<string>, idf: (t: string) => number): number {
  let inter = 0;
  let wa = 0;
  let wb = 0;
  for (const t of a) {
    const w = idf(t);
    wa += w;
    if (b.has(t)) inter += w;
  }
  for (const t of b) wb += idf(t);
  const union = wa + wb - inter;
  if (union <= 0) return 0;
  const jaccard = inter / union;
  const overlap = inter / Math.min(wa, wb);
  return 0.5 * jaccard + 0.5 * overlap;
}

/** Items processed between pauses; keeps each synchronous slice to a few milliseconds. */
const SLICE = 500;

async function mapInSlices<T, U>(items: T[], fn: (x: T) => U): Promise<U[]> {
  const out: U[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(fn(items[i]));
    if (i % SLICE === SLICE - 1) await yieldToEventLoop();
  }
  return out;
}

/**
 * Candidate generation. An inverted index over Kalshi tokens keeps this near-linear: each
 * Polymarket market is only compared with Kalshi markets sharing informative tokens.
 * Async only so it can pause between slices; full catalogs take seconds of CPU.
 */
export async function generateCandidates(kalshi: KalshiMarket[], poly: PolyMarket[], o: CandidateOptions): Promise<Candidate[]> {
  const kTokens = await mapInSlices(kalshi, (m) => new Set(normalizeTokens(kalshiDisplayTitle(m))));
  const pTokens = await mapInSlices(poly, (m) => new Set(normalizeTokens(m.question)));

  const df = new Map<string, number>();
  for (const set of [...kTokens, ...pTokens]) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const n = kTokens.length + pTokens.length;
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 1));

  const index = new Map<string, number[]>();
  kTokens.forEach((set, i) => {
    for (const t of set) {
      let list = index.get(t);
      if (!list) index.set(t, (list = []));
      list.push(i);
    }
  });
  // Very common tokens contribute little and explode the fan-out.
  const maxPosting = Math.max(500, Math.ceil(kalshi.length * 0.05));

  const out: Candidate[] = [];
  const perPoly = o.perPolyMarket ?? 5;
  for (let pi = 0; pi < poly.length; pi++) {
    if (pi % SLICE === SLICE - 1) await yieldToEventLoop();
    const pm = poly[pi];
    const acc = new Map<number, number>();
    for (const t of pTokens[pi]) {
      const posting = index.get(t);
      if (!posting || posting.length > maxPosting) continue;
      const w = idf(t);
      for (const ki of posting) acc.set(ki, (acc.get(ki) ?? 0) + w);
    }
    const shortlist = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, perPoly * 4);
    const scored: Candidate[] = [];
    for (const [ki] of shortlist) {
      const km = kalshi[ki];
      if (o.exclude?.has(pairKey(km.ticker, pm.id))) continue;
      const apart = daysApart(kalshiResolutionDate(km), pm.endDateIso);
      if (!o.ignoreDates && apart !== null && apart > o.maxCloseDaysApart) continue;
      const textScore = tokenSetSimilarity(kTokens[ki], pTokens[pi], idf);
      const dateScore = apart === null ? 0.5 : Math.max(0, 1 - apart / Math.max(o.maxCloseDaysApart, 1));
      const score = 0.8 * textScore + 0.2 * dateScore;
      if (score < o.minScore) continue;
      scored.push({
        kalshiTicker: km.ticker,
        polyMarketId: pm.id,
        score,
        textScore,
        dateScore,
        closeDaysApart: apart,
        kalshiTitle: kalshiDisplayTitle(km),
        polyQuestion: pm.question,
      });
    }
    scored.sort((x, y) => y.score - x.score);
    out.push(...scored.slice(0, perPoly));
  }
  return out.sort((x, y) => y.score - x.score).slice(0, o.limit);
}
