"use client";

import useSWR from "swr";
import type { ScanRecord } from "@/lib/db";
import type { VenueHealth } from "@/lib/http";
import { ago, date, fetcher } from "./fmt";

interface HealthResponse {
  venues: VenueHealth[];
  scanner: {
    pollerStarted: boolean;
    scanning: boolean;
    lastScanAt: string | null;
    lastScanDurationMs: number | null;
    lastScanError: string | null;
    refreshing: boolean;
    lastRefreshAt: string | null;
    lastRefreshError: string | null;
    lastRefreshCounts: { kalshi: number; polymarket: number } | null;
  };
  cachedMarkets: { kalshi: number; polymarket: number };
  recentScans: ScanRecord[];
  config: Record<string, unknown>;
}

export default function HealthTab() {
  const { data, error } = useSWR<HealthResponse>("/api/health", fetcher, { refreshInterval: 5000 });
  if (error) return <p className="error">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const s = data.scanner;
  return (
    <>
      <div className="grid2">
        {data.venues.map((v) => (
          <div className="panel" key={v.venue}>
            <h3 style={{ marginTop: 0, textTransform: "capitalize" }}>{v.venue}</h3>
            <dl className="kv">
              <dt>Last successful fetch</dt>
              <dd>
                {ago(v.lastSuccessAt)} <span className="muted small">{date(v.lastSuccessAt)}</span>
              </dd>
              <dt>Requests</dt>
              <dd>{v.requests}</dd>
              <dt>Errors</dt>
              <dd className={v.errors ? "neg" : ""}>{v.errors}</dd>
              <dt>Rate-limit hits (429)</dt>
              <dd className={v.rateLimitHits ? "neg" : ""}>{v.rateLimitHits}</dd>
              <dt>Last error</dt>
              <dd className="small">{v.lastError ? `${ago(v.lastErrorAt)}: ${v.lastError}` : "—"}</dd>
            </dl>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Scanner</h3>
        <dl className="kv">
          <dt>Poller</dt>
          <dd>{s.pollerStarted ? "running" : "stopped"}{s.scanning && " · scanning now"}</dd>
          <dt>Last scan</dt>
          <dd>
            {ago(s.lastScanAt)}
            {s.lastScanDurationMs != null && ` · took ${(s.lastScanDurationMs / 1000).toFixed(1)}s`}
          </dd>
          <dt>Last scan error</dt>
          <dd className="small">{s.lastScanError ?? "—"}</dd>
          <dt>Catalog refresh</dt>
          <dd>
            {ago(s.lastRefreshAt)}
            {s.refreshing && " · refreshing now"}
          </dd>
          <dt>Last refresh error</dt>
          <dd className="small">{s.lastRefreshError ?? "—"}</dd>
          <dt>Cached markets</dt>
          <dd>
            {data.cachedMarkets.kalshi} Kalshi / {data.cachedMarkets.polymarket} Polymarket
          </dd>
          <dt>Config</dt>
          <dd className="mono small">{JSON.stringify(data.config)}</dd>
        </dl>
      </div>
      <div className="panel table-wrap">
        <h3 style={{ marginTop: 0 }}>Recent scans</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Started</th>
              <th className="num">Pairs</th>
              <th className="num">Opportunities</th>
              <th className="num">Errors</th>
              <th>Error summary</th>
            </tr>
          </thead>
          <tbody>
            {data.recentScans.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td>{date(r.startedAt)}</td>
                <td className="num">{r.pairsScanned}</td>
                <td className="num">{r.opportunities}</td>
                <td className={`num ${r.errors ? "neg" : ""}`}>{r.errors}</td>
                <td className="small" style={{ whiteSpace: "pre-wrap" }}>
                  {r.errorSummary ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
