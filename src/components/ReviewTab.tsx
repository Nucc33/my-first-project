"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import type { KalshiMarket } from "@/lib/kalshi/parse";
import type { Candidate } from "@/lib/matching/candidates";
import type { PolyMarket } from "@/lib/polymarket/parse";
import type { RefreshProgress } from "@/lib/scanner";
import { ago, date, fetcher, postJson } from "./fmt";

interface CandResponse {
  candidates: Candidate[];
  counts: { kalshi: number; polymarket: number };
  lastRefreshAt: string | null;
  refreshing: boolean;
  refreshProgress: RefreshProgress | null;
  refreshError: string | null;
  /** Scored from a catalog that is still downloading. */
  partial?: boolean;
}

const n = (x: number) => x.toLocaleString("en-US");

function ProgressLine({ p }: { p: RefreshProgress }) {
  const venue = (name: string, pages: number, markets: number, done: boolean) =>
    `${name}: ${n(markets)} markets (${n(pages)} pages)${done ? " ✓ done" : " …"}`;
  return (
    <div className="small" style={{ width: "100%" }}>
      <strong>Downloading markets</strong> (started {ago(p.startedAt)}) ·{" "}
      {venue("Kalshi", p.kalshiPages, p.kalshiMarkets, p.kalshiDone)} ·{" "}
      {venue("Polymarket", p.polyPages, p.polyMarkets, p.polyDone)}
      <div className="muted">
        Kalshi lists a very large number of markets, so the first download can take several minutes. You can review
        candidates below while it runs.
      </div>
    </div>
  );
}

interface Selection {
  kalshiTicker: string;
  polyMarketId: string;
}

export default function ReviewTab() {
  const [ignoreDates, setIgnoreDates] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [manual, setManual] = useState<Selection>({ kalshiTicker: "", polyMarketId: "" });
  const { data, error, mutate } = useSWR<CandResponse>(`/api/candidates${ignoreDates ? "?ignoreDates=1" : ""}`, fetcher, {
    // Poll quickly while a download is running so the progress numbers move.
    refreshInterval: (latest) => (latest?.refreshing ? 3_000 : 30_000),
  });

  const refresh = async () => {
    setRefreshMsg(null);
    const request = postJson<{ alreadyRunning?: boolean; counts?: { kalshi: number; polymarket: number } }>("/api/markets/refresh");
    // The request only returns when the download finishes; re-poll now so progress shows immediately.
    setTimeout(() => mutate(), 500);
    try {
      const r = await request;
      if (r.counts) setRefreshMsg(`Loaded ${n(r.counts.kalshi)} Kalshi and ${n(r.counts.polymarket)} Polymarket markets`);
    } catch (e) {
      setRefreshMsg(`Refresh failed: ${(e as Error).message}`);
    }
    mutate();
  };

  return (
    <>
      <div className="panel controls">
        <button onClick={refresh} disabled={data?.refreshing}>
          Refresh markets
        </button>
        <label className="row" style={{ flexDirection: "row" }}>
          <input type="checkbox" checked={ignoreDates} onChange={(e) => setIgnoreDates(e.target.checked)} />
          Include pairs whose close dates are far apart
        </label>
        <span className="muted small">
          {data && (
            <>
              Cached: {n(data.counts.kalshi)} Kalshi / {n(data.counts.polymarket)} Polymarket · last complete download{" "}
              {data.lastRefreshAt ? ago(data.lastRefreshAt) : "none yet"}
            </>
          )}
          {refreshMsg && <> · {refreshMsg}</>}
        </span>
        {data?.refreshProgress && <ProgressLine p={data.refreshProgress} />}
        {data?.refreshError && (
          <span className="error small">
            Last download failed: {data.refreshError}. It will retry in a few minutes, or click Refresh markets.
          </span>
        )}
      </div>

      <div className="panel controls">
        <strong>Manual pair</strong>
        <label>
          Kalshi ticker
          <input value={manual.kalshiTicker} onChange={(e) => setManual({ ...manual, kalshiTicker: e.target.value })} placeholder="KXFED-26DEC-T4.00" />
        </label>
        <label>
          Polymarket market id
          <input value={manual.polyMarketId} onChange={(e) => setManual({ ...manual, polyMarketId: e.target.value })} placeholder="123456" />
        </label>
        <button disabled={!manual.kalshiTicker || !manual.polyMarketId} onClick={() => setSel({ ...manual })}>
          Load side by side
        </button>
      </div>

      {sel && (
        <PairReview
          key={`${sel.kalshiTicker}|${sel.polyMarketId}`}
          sel={sel}
          onDone={() => {
            setSel(null);
            mutate();
          }}
        />
      )}

      <div className="panel table-wrap">
        <h3 style={{ marginTop: 0 }}>Candidates</h3>
        <p className="muted small">
          Generated from normalized-title similarity and close-date proximity. A high score does <strong>not</strong> mean the
          markets resolve identically. Read both rule texts.
        </p>
        {error && <p className="error">{(error as Error).message}</p>}
        {data?.partial && (
          <p className="small warn-note">
            Based on the markets downloaded so far. The list will update when the download finishes.
          </p>
        )}
        {data && data.candidates.length === 0 && (
          <p className="muted">
            {data.refreshing && data.counts.kalshi + data.counts.polymarket === 0
              ? "Waiting for the first markets to download…"
              : "No unreviewed candidates. Try “Refresh markets” or include far-apart close dates."}
          </p>
        )}
        {data && data.candidates.length > 0 && (
          <table>
            <thead>
              <tr>
                <th className="num">Score</th>
                <th>Kalshi</th>
                <th>Polymarket</th>
                <th className="num">Close Δ (days)</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => {
                const active = sel?.kalshiTicker === c.kalshiTicker && sel?.polyMarketId === c.polyMarketId;
                return (
                  <tr
                    key={`${c.kalshiTicker}|${c.polyMarketId}`}
                    className={`clickable ${active ? "selected" : ""}`}
                    onClick={() => {
                      setSel({ kalshiTicker: c.kalshiTicker, polyMarketId: c.polyMarketId });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <td className="num">{c.score.toFixed(2)}</td>
                    <td>
                      {c.kalshiTitle}
                      <div className="muted small mono">{c.kalshiTicker}</div>
                    </td>
                    <td>
                      {c.polyQuestion}
                      <div className="muted small mono">{c.polyMarketId}</div>
                    </td>
                    <td className="num">{c.closeDaysApart == null ? "?" : c.closeDaysApart.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

type KalshiDetail = KalshiMarket & { url: string };
type PolyDetail = PolyMarket & { url: string };

function PairReview({ sel, onDone }: { sel: Selection; onDone: () => void }) {
  const { data, error } = useSWR<{ kalshi: KalshiDetail | null; poly: PolyDetail | null; errors: string[] }>(
    `/api/markets/detail?kalshi=${encodeURIComponent(sel.kalshiTicker)}&poly=${encodeURIComponent(sel.polyMarketId)}`,
    fetcher,
  );
  const [yesToken, setYesToken] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [attest, setAttest] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      setReviewer(localStorage.getItem("arb.reviewer") ?? "");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (data?.poly?.category && !category) setCategory(data.poly.category);
  }, [data, category]);

  const k = data?.kalshi;
  const p = data?.poly;
  const noOutcome = p?.outcomes.find((o) => o.tokenId !== yesToken);
  const yesOutcome = p?.outcomes.find((o) => o.tokenId === yesToken);

  const submit = async (status: "confirmed" | "rejected") => {
    setMsg(null);
    try {
      localStorage.setItem("arb.reviewer", reviewer);
    } catch {
      /* ignore */
    }
    try {
      await postJson("/api/pairs", {
        kalshiTicker: sel.kalshiTicker,
        polyMarketId: sel.polyMarketId,
        polyTokenForKalshiYes: yesToken,
        polyTokenForKalshiNo: yesToken ? (noOutcome?.tokenId ?? "") : "",
        polyOutcomeForKalshiYes: yesOutcome?.label,
        polyOutcomeForKalshiNo: yesToken ? noOutcome?.label : undefined,
        status,
        category: category || null,
        confirmedBy: reviewer,
        notes,
      });
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const canConfirm = !!k && !!p && !!yesToken && !!noOutcome && reviewer.trim() !== "" && attest;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Review pair</h3>
        <button onClick={onDone}>Close</button>
      </div>
      {error && <p className="error">{(error as Error).message}</p>}
      {data?.errors.map((e) => (
        <p key={e} className="error">
          {e}
        </p>
      ))}
      {!data && <p className="muted">Loading…</p>}
      {data && (
        <div className="grid2">
          <div>
            <h4>Kalshi</h4>
            {!k ? (
              <p className="error">Kalshi market {sel.kalshiTicker} not found.</p>
            ) : (
              <>
                <strong>{k.title}</strong>
                {k.yesSubTitle && <div>YES = {k.yesSubTitle}</div>}
                {k.noSubTitle && <div className="muted">NO = {k.noSubTitle}</div>}
                <dl className="kv small">
                  <dt>Ticker</dt>
                  <dd className="mono">{k.ticker}</dd>
                  <dt>Series</dt>
                  <dd className="mono">{k.seriesTicker}</dd>
                  <dt>Close</dt>
                  <dd>{date(k.closeTime)}</dd>
                  <dt>Expected expiry</dt>
                  <dd>{date(k.expectedExpirationTime)}</dd>
                  <dt>Status</dt>
                  <dd>{k.status}</dd>
                  <dt>YES / NO ask</dt>
                  <dd>
                    {k.yesAsk ?? "—"} / {k.noAsk ?? "—"}
                  </dd>
                  <dt>Link</dt>
                  <dd>
                    <a href={k.url} target="_blank" rel="noreferrer">
                      {k.url}
                    </a>
                  </dd>
                </dl>
                <div className="small muted">Rules (primary + secondary)</div>
                <div className="rules">
                  {k.rulesPrimary || "(none)"}
                  {k.rulesSecondary ? `\n\n${k.rulesSecondary}` : ""}
                </div>
              </>
            )}
          </div>
          <div>
            <h4>Polymarket</h4>
            {!p ? (
              <p className="error">Polymarket market {sel.polyMarketId} not found or not tradable.</p>
            ) : (
              <>
                <strong>{p.question}</strong>
                <div>Outcomes: {p.outcomes.map((o) => `${o.label}${o.price ? ` (${o.price})` : ""}`).join(" / ")}</div>
                <dl className="kv small">
                  <dt>Market id</dt>
                  <dd className="mono">{p.id}</dd>
                  <dt>End date</dt>
                  <dd>{date(p.endDateIso)}</dd>
                  <dt>Resolution source</dt>
                  <dd>{p.resolutionSource || "—"}</dd>
                  <dt>Fees</dt>
                  <dd>
                    {p.fee.enabled ? `rate ${p.fee.rate ?? "unknown"}, exponent ${p.fee.exponent ?? "?"}` : "disabled"}
                  </dd>
                  <dt>Neg-risk</dt>
                  <dd>{p.negRisk ? "yes" : "no"}</dd>
                  <dt>Category</dt>
                  <dd>{p.category ?? "—"}</dd>
                  <dt>Link</dt>
                  <dd>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {p.url}
                    </a>
                  </dd>
                </dl>
                <div className="small muted">Description / rules</div>
                <div className="rules">{p.description || "(none)"}</div>
              </>
            )}
          </div>
        </div>
      )}

      {k && p && (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="row">
            <label>
              Polymarket outcome that pays when <strong>Kalshi resolves YES</strong>
              {k.yesSubTitle ? ` (${k.yesSubTitle})` : ""}:{" "}
              <select value={yesToken} onChange={(e) => setYesToken(e.target.value)}>
                <option value="">— choose explicitly —</option>
                {p.outcomes.map((o) => (
                  <option key={o.tokenId} value={o.tokenId}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {yesToken && (
            <div className="small">
              Mapping: Kalshi YES ⇔ Polymarket “{yesOutcome?.label}” · Kalshi NO ⇔ Polymarket “{noOutcome?.label}”
            </div>
          )}
          <div className="row">
            <label>
              Reviewer <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="your name" />
            </label>
            <label>
              Category <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Politics" />
            </label>
          </div>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (edge cases, source differences, …)" />
          <label className="row">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />I have read both rule texts,
            and these markets resolve identically under the mapping above (including postponements and data sources).
          </label>
          <div className="row">
            <button className="primary" disabled={!canConfirm} onClick={() => submit("confirmed")}>
              Confirm pair
            </button>
            <button className="danger" disabled={!reviewer.trim()} onClick={() => submit("rejected")}>
              Reject
            </button>
            {msg && <span className="error">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
