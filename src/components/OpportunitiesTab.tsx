"use client";

import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import type { Opportunity, Skip } from "@/lib/evaluate";
import { ago, fetcher, pct, postJson, usd } from "./fmt";

interface OppResponse {
  opportunities: Opportunity[];
  skips: Skip[];
  categories: string[];
  confirmedPairs: number;
  lastScanAt: string | null;
  lastScanDurationMs: number | null;
  scanning: boolean;
  serverTime: number;
  maxCapital: string;
}

interface Filters {
  minProfit: string;
  minRoi: string;
  maxCapital: string;
  category: string;
}
const DEFAULTS: Filters = { minProfit: "0", minRoi: "0", maxCapital: "1000", category: "" };

export default function OpportunitiesTab() {
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [open, setOpen] = useState<string | null>(null);
  const [showSkips, setShowSkips] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("arb.filters");
      if (saved) setF({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {
      /* ignore */
    }
  }, []);
  const update = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    setF(next);
    try {
      localStorage.setItem("arb.filters", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const qs = new URLSearchParams();
  if (f.minProfit) qs.set("minProfit", f.minProfit);
  if (f.minRoi) qs.set("minRoi", f.minRoi);
  if (f.maxCapital) qs.set("maxCapital", f.maxCapital);
  if (f.category) qs.set("category", f.category);
  const { data, error, mutate } = useSWR<OppResponse>(`/api/opportunities?${qs}`, fetcher, { refreshInterval: 5000 });

  const scanNow = async () => {
    setScanMsg("Scanning…");
    try {
      const r = await postJson<{ opportunities: number }>("/api/scan");
      setScanMsg(`Scan done: ${r.opportunities} opportunities at default capital`);
      mutate();
    } catch (e) {
      setScanMsg(`Scan failed: ${(e as Error).message}`);
    }
  };

  const now = data?.serverTime ?? Date.now();
  return (
    <>
      <div className="panel controls">
        <label>
          Min profit ($)
          <input type="number" min="0" step="0.5" value={f.minProfit} onChange={(e) => update({ minProfit: e.target.value })} />
        </label>
        <label>
          Min ROI (%)
          <input type="number" min="0" step="0.1" value={f.minRoi} onChange={(e) => update({ minRoi: e.target.value })} />
        </label>
        <label>
          Max capital / trade ($)
          <input type="number" min="0" step="50" value={f.maxCapital} onChange={(e) => update({ maxCapital: e.target.value })} />
        </label>
        <label>
          Category
          <select value={f.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All</option>
            {data?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button onClick={scanNow}>Scan now</button>
        <span className="muted small">
          {data ? (
            <>
              {data.confirmedPairs} confirmed pairs · last scan {ago(data.lastScanAt, now)}
              {data.lastScanDurationMs != null && ` (${(data.lastScanDurationMs / 1000).toFixed(1)}s)`}
              {data.scanning && " · scanning…"}
            </>
          ) : (
            "Loading…"
          )}
          {scanMsg && ` · ${scanMsg}`}
        </span>
      </div>

      {error && <p className="error">Error: {(error as Error).message}</p>}

      <div className="panel table-wrap">
        {data && data.opportunities.length === 0 && (
          <p className="muted">
            {data.confirmedPairs === 0
              ? "No confirmed pairs yet. Confirm some on the Review tab. Only confirmed pairs are scanned."
              : "No opportunities right now at these settings."}
          </p>
        )}
        {data && data.opportunities.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Direction</th>
                <th className="num">Contracts</th>
                <th className="num">Cost</th>
                <th className="num">Profit</th>
                <th className="num">ROI</th>
                <th className="num">Ann. ROI</th>
                <th className="num">Days</th>
                <th className="num">Data age</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {data.opportunities.map((o) => {
                const key = `${o.pairId}-${o.direction}`;
                return (
                  <Fragment key={key}>
                    <tr className={`clickable ${open === key ? "selected" : ""}`} onClick={() => setOpen(open === key ? null : key)}>
                      <td>
                        <div>{o.kalshiTitle}</div>
                        <div className="muted small">{o.polyQuestion}</div>
                        {o.warnings.length > 0 && <div className="small error">⚠ {o.warnings.join("; ")}</div>}
                      </td>
                      <td>
                        <span className="pill">{o.direction}</span> <span className="small">{o.label}</span>
                      </td>
                      <td className="num">{Number(o.contracts).toFixed(2)}</td>
                      <td className="num">{usd(o.totalCost)}</td>
                      <td className="num pos">{usd(o.profit)}</td>
                      <td className="num">{pct(o.roi)}</td>
                      <td className="num">{pct(o.annualizedRoi, 1)}</td>
                      <td className="num">{o.daysToResolution == null ? "—" : o.daysToResolution.toFixed(1)}</td>
                      <td className="num">
                        {ago(o.bookFetchedAt, now)}
                        <div className="muted small">skew {o.bookSkewMs}ms</div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <a href={o.kalshiUrl} target="_blank" rel="noreferrer">
                          Kalshi
                        </a>{" "}
                        ·{" "}
                        <a href={o.polyUrl} target="_blank" rel="noreferrer">
                          Polymarket
                        </a>
                      </td>
                    </tr>
                    {open === key && (
                      <tr>
                        <td colSpan={10}>
                          <div className="grid2">
                            <LegDetail title={`Kalshi ${o.kalshiSide.toUpperCase()} · ${o.kalshiTicker}`} leg={o.kalshi} />
                            <LegDetail title={`Polymarket "${o.polyOutcome}" · market ${o.polyMarketId}`} leg={o.poly} />
                          </div>
                          <p className="small">
                            Total cost {usd(o.totalCost, 5)} · guaranteed payout {usd(o.payout)} · net profit {usd(o.profit, 5)} · ROI{" "}
                            {pct(o.roi, 3)}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.skips.length > 0 && (
        <div className="panel">
          <button onClick={() => setShowSkips(!showSkips)}>
            {showSkips ? "Hide" : "Show"} {data.skips.length} skipped pair/directions
          </button>
          {showSkips && (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Dir</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.skips.map((s, i) => (
                  <tr key={i}>
                    <td className="mono">#{s.pairId}</td>
                    <td>{s.direction ?? "both"}</td>
                    <td>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function LegDetail({ title, leg }: { title: string; leg: Opportunity["kalshi"] }) {
  return (
    <div>
      <strong>{title}</strong>
      <dl className="kv small">
        <dt>Avg price</dt>
        <dd>{usd(leg.avgPrice, 4)}</dd>
        <dt>Notional</dt>
        <dd>{usd(leg.notional, 4)}</dd>
        <dt>Fees</dt>
        <dd>{usd(leg.fees, 5)}</dd>
        <dt>Levels used</dt>
        <dd>{leg.levelsConsumed}</dd>
      </dl>
      <table className="small">
        <thead>
          <tr>
            <th className="num">Price</th>
            <th className="num">Contracts</th>
            <th className="num">Fee</th>
          </tr>
        </thead>
        <tbody>
          {leg.levels.map((l, i) => (
            <tr key={i}>
              <td className="num">{l.price}</td>
              <td className="num">{l.contracts}</td>
              <td className="num">{l.fee}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
