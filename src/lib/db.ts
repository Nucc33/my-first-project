import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import type { KalshiMarket } from "./kalshi/parse";
import type { Pair, PairInput, PairStatus } from "./pairs";
import type { PolyMarket } from "./polymarket/parse";

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kalshi_ticker TEXT NOT NULL,
  poly_market_id TEXT NOT NULL,
  poly_token_for_kalshi_yes TEXT NOT NULL DEFAULT '',
  poly_token_for_kalshi_no TEXT NOT NULL DEFAULT '',
  poly_outcome_for_kalshi_yes TEXT NOT NULL DEFAULT '',
  poly_outcome_for_kalshi_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  category TEXT,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (kalshi_ticker, poly_market_id)
);

CREATE TABLE IF NOT EXISTS kalshi_markets (
  ticker TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS poly_markets (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  pairs_scanned INTEGER NOT NULL DEFAULT 0,
  opportunities INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS scan_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  pair_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  contracts TEXT NOT NULL,
  total_cost TEXT NOT NULL,
  profit TEXT NOT NULL,
  roi TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_opps_scan ON scan_opportunities(scan_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const g = globalThis as unknown as { __arbDb?: DB };

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DB {
  return (g.__arbDb ??= openDb(getConfig().dbPath));
}

/** Test hook: swap in an in-memory DB. */
export function setDb(db: DB): void {
  g.__arbDb = db;
}

// ---------- pairs ----------

interface PairRow {
  id: number;
  kalshi_ticker: string;
  poly_market_id: string;
  poly_token_for_kalshi_yes: string;
  poly_token_for_kalshi_no: string;
  poly_outcome_for_kalshi_yes: string;
  poly_outcome_for_kalshi_no: string;
  status: PairStatus;
  category: string | null;
  confirmed_by: string;
  confirmed_at: string;
  notes: string;
}

function rowToPair(r: PairRow): Pair {
  return {
    id: r.id,
    kalshiTicker: r.kalshi_ticker,
    polyMarketId: r.poly_market_id,
    polyTokenForKalshiYes: r.poly_token_for_kalshi_yes,
    polyTokenForKalshiNo: r.poly_token_for_kalshi_no,
    polyOutcomeForKalshiYes: r.poly_outcome_for_kalshi_yes,
    polyOutcomeForKalshiNo: r.poly_outcome_for_kalshi_no,
    status: r.status,
    category: r.category,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    notes: r.notes,
  };
}

export function listPairs(status?: PairStatus, db: DB = getDb()): Pair[] {
  const rows = status
    ? db.prepare("SELECT * FROM pairs WHERE status = ? ORDER BY id").all(status)
    : db.prepare("SELECT * FROM pairs ORDER BY id").all();
  return (rows as PairRow[]).map(rowToPair);
}

export function getPair(id: number, db: DB = getDb()): Pair | null {
  const r = db.prepare("SELECT * FROM pairs WHERE id = ?").get(id) as PairRow | undefined;
  return r ? rowToPair(r) : null;
}

/** Insert or replace the decision for (kalshi_ticker, poly_market_id). */
export function upsertPair(p: PairInput, db: DB = getDb()): Pair {
  db.prepare(
    `INSERT INTO pairs (kalshi_ticker, poly_market_id, poly_token_for_kalshi_yes, poly_token_for_kalshi_no,
       poly_outcome_for_kalshi_yes, poly_outcome_for_kalshi_no, status, category, confirmed_by, confirmed_at, notes)
     VALUES (@kalshiTicker, @polyMarketId, @yes, @no, @yesLabel, @noLabel, @status, @category, @confirmedBy, @confirmedAt, @notes)
     ON CONFLICT (kalshi_ticker, poly_market_id) DO UPDATE SET
       poly_token_for_kalshi_yes = excluded.poly_token_for_kalshi_yes,
       poly_token_for_kalshi_no = excluded.poly_token_for_kalshi_no,
       poly_outcome_for_kalshi_yes = excluded.poly_outcome_for_kalshi_yes,
       poly_outcome_for_kalshi_no = excluded.poly_outcome_for_kalshi_no,
       status = excluded.status,
       category = excluded.category,
       confirmed_by = excluded.confirmed_by,
       confirmed_at = excluded.confirmed_at,
       notes = excluded.notes`,
  ).run({
    kalshiTicker: p.kalshiTicker,
    polyMarketId: p.polyMarketId,
    yes: p.polyTokenForKalshiYes ?? "",
    no: p.polyTokenForKalshiNo ?? "",
    yesLabel: p.polyOutcomeForKalshiYes ?? "",
    noLabel: p.polyOutcomeForKalshiNo ?? "",
    status: p.status ?? "confirmed",
    category: p.category ?? null,
    confirmedBy: p.confirmedBy,
    confirmedAt: p.confirmedAt ?? new Date().toISOString(),
    notes: p.notes ?? "",
  });
  const r = db
    .prepare("SELECT * FROM pairs WHERE kalshi_ticker = ? AND poly_market_id = ?")
    .get(p.kalshiTicker, p.polyMarketId) as PairRow;
  return rowToPair(r);
}

export function deletePair(id: number, db: DB = getDb()): boolean {
  return db.prepare("DELETE FROM pairs WHERE id = ?").run(id).changes > 0;
}

// ---------- market cache ----------

export function saveKalshiMarkets(markets: KalshiMarket[], db: DB = getDb()): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO kalshi_markets (ticker, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(ticker) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  );
  db.transaction(() => {
    for (const m of markets) stmt.run(m.ticker, JSON.stringify(m), now);
  })();
}

export function savePolyMarkets(markets: PolyMarket[], db: DB = getDb()): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO poly_markets (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  );
  db.transaction(() => {
    for (const m of markets) stmt.run(m.id, JSON.stringify(m), now);
  })();
}

/** Drop cached markets not seen since `before` (closed/delisted), except ones referenced by pairs. */
export function pruneMarkets(before: string, db: DB = getDb()): void {
  db.prepare("DELETE FROM kalshi_markets WHERE updated_at < ? AND ticker NOT IN (SELECT kalshi_ticker FROM pairs)").run(before);
  db.prepare("DELETE FROM poly_markets WHERE updated_at < ? AND id NOT IN (SELECT poly_market_id FROM pairs)").run(before);
}

export function getKalshiMarkets(tickers?: string[], db: DB = getDb()): KalshiMarket[] {
  const rows = tickers
    ? tickers.map((t) => db.prepare("SELECT data FROM kalshi_markets WHERE ticker = ?").get(t)).filter(Boolean)
    : db.prepare("SELECT data FROM kalshi_markets").all();
  return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function getPolyMarkets(ids?: string[], db: DB = getDb()): PolyMarket[] {
  const rows = ids
    ? ids.map((id) => db.prepare("SELECT data FROM poly_markets WHERE id = ?").get(id)).filter(Boolean)
    : db.prepare("SELECT data FROM poly_markets").all();
  return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function marketCounts(db: DB = getDb()): { kalshi: number; polymarket: number } {
  const k = db.prepare("SELECT COUNT(*) c FROM kalshi_markets").get() as { c: number };
  const p = db.prepare("SELECT COUNT(*) c FROM poly_markets").get() as { c: number };
  return { kalshi: k.c, polymarket: p.c };
}

// ---------- meta ----------

export function getMeta(key: string, db: DB = getDb()): string | null {
  const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setMeta(key: string, value: string, db: DB = getDb()): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- scan history ----------

export interface ScanRecord {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  pairsScanned: number;
  opportunities: number;
  errors: number;
  errorSummary: string | null;
}

export function recordScan(
  s: Omit<ScanRecord, "id">,
  opps: Array<{ pairId: number; direction: string; contracts: string; totalCost: string; profit: string; roi: string }>,
  keep = 2000,
  db: DB = getDb(),
): number {
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO scans (started_at, finished_at, pairs_scanned, opportunities, errors, error_summary) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(s.startedAt, s.finishedAt, s.pairsScanned, s.opportunities, s.errors, s.errorSummary).lastInsertRowid,
    );
    const ins = db.prepare(
      "INSERT INTO scan_opportunities (scan_id, pair_id, direction, contracts, total_cost, profit, roi, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const o of opps) ins.run(id, o.pairId, o.direction, o.contracts, o.totalCost, o.profit, o.roi, JSON.stringify(o));
    db.prepare("DELETE FROM scans WHERE id <= ?").run(id - keep);
    return id;
  })();
}

export function recentScans(limit = 20, db: DB = getDb()): ScanRecord[] {
  const rows = db.prepare("SELECT * FROM scans ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    pairsScanned: r.pairs_scanned as number,
    opportunities: r.opportunities as number,
    errors: r.errors as number,
    errorSummary: (r.error_summary as string) ?? null,
  }));
}
