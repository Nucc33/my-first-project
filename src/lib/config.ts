import Decimal from "decimal.js";

/**
 * All tunables come from environment variables (see .env.example).
 * Values are read once per process; restart the server after changing them.
 */
export interface Config {
  kalshiBaseUrl: string;
  polyGammaBaseUrl: string;
  polyClobBaseUrl: string;

  pollIntervalMs: number;
  marketRefreshIntervalMs: number;
  kalshiRequestsPerSecond: number;
  polyRequestsPerSecond: number;
  maxRetries: number;
  requestTimeoutMs: number;

  /** Skip a pair if its two books were fetched further apart than this. */
  stalenessMs: number;
  /** Required edge per contract, in dollars (0.01 = one cent per contract). */
  minEdgePerContract: Decimal;
  /** Default max capital per trade (dollars) used by the background scan. */
  defaultMaxCapital: Decimal;
  /** Skip an opportunity if either leg's notional is below this (dollars). */
  minLegNotional: Decimal;
  /** Skip an opportunity with fewer contracts than this. */
  minContracts: Decimal;

  kalshiTakerFeeRate: Decimal;
  /** Per-series multiplier on the Kalshi taker fee. Missing series = 1. */
  kalshiFeeMultipliers: Record<string, Decimal>;
  /** Honour `fee_waiver_expiration_time` (fees 0 until then). Off = conservative. */
  kalshiHonorFeeWaiver: boolean;
  /** Rate used when a fee-enabled Polymarket market has no feeSchedule. */
  polyFallbackFeeRate: Decimal;

  /** Reject automatic candidates whose close dates differ by more than this. */
  matchMaxCloseDaysApart: number;
  matchMinScore: number;
  matchMaxCandidates: number;

  dbPath: string;
  /** Disable the background poller (tests, scripts). */
  disablePoller: boolean;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function dec(name: string, def: string): Decimal {
  const raw = process.env[name];
  try {
    return new Decimal(raw === undefined || raw.trim() === "" ? def : raw.trim());
  } catch {
    throw new Error(`Env ${name} must be a decimal number, got "${raw}"`);
  }
}

function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? def : raw.trim();
}

function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Parses "KXHIGHNY=0.5,KXFED=0" into { KXHIGHNY: 0.5, KXFED: 0 }. */
export function parseMultipliers(raw: string | undefined): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [k, v] = trimmed.split("=").map((s) => s.trim());
    if (!k || v === undefined || v === "") throw new Error(`Bad KALSHI_FEE_MULTIPLIERS entry "${trimmed}"`);
    out[k.toUpperCase()] = new Decimal(v);
  }
  return out;
}

export function loadConfig(): Config {
  return {
    kalshiBaseUrl: str("KALSHI_BASE_URL", "https://external-api.kalshi.com/trade-api/v2"),
    polyGammaBaseUrl: str("POLY_GAMMA_BASE_URL", "https://gamma-api.polymarket.com"),
    polyClobBaseUrl: str("POLY_CLOB_BASE_URL", "https://clob.polymarket.com"),

    pollIntervalMs: num("POLL_INTERVAL_MS", 15_000),
    marketRefreshIntervalMs: num("MARKET_REFRESH_INTERVAL_MS", 30 * 60_000),
    kalshiRequestsPerSecond: num("KALSHI_REQUESTS_PER_SECOND", 10),
    polyRequestsPerSecond: num("POLY_REQUESTS_PER_SECOND", 10),
    maxRetries: num("HTTP_MAX_RETRIES", 5),
    requestTimeoutMs: num("HTTP_TIMEOUT_MS", 15_000),

    stalenessMs: num("STALENESS_MS", 5_000),
    minEdgePerContract: dec("MIN_EDGE_PER_CONTRACT", "0"),
    defaultMaxCapital: dec("DEFAULT_MAX_CAPITAL", "1000"),
    minLegNotional: dec("MIN_LEG_NOTIONAL", "1"),
    minContracts: dec("MIN_CONTRACTS", "1"),

    kalshiTakerFeeRate: dec("KALSHI_TAKER_FEE_RATE", "0.07"),
    kalshiFeeMultipliers: parseMultipliers(process.env.KALSHI_FEE_MULTIPLIERS),
    kalshiHonorFeeWaiver: bool("KALSHI_HONOR_FEE_WAIVER", false),
    polyFallbackFeeRate: dec("POLY_FALLBACK_FEE_RATE", "0.07"),

    matchMaxCloseDaysApart: num("MATCH_MAX_CLOSE_DAYS_APART", 3),
    matchMinScore: num("MATCH_MIN_SCORE", 0.35),
    matchMaxCandidates: num("MATCH_MAX_CANDIDATES", 200),

    dbPath: str("DB_PATH", "./data/scanner.sqlite"),
    disablePoller: bool("DISABLE_POLLER", false),
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}
