"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import type { Pair } from "@/lib/pairs";
import { date, fetcher, postJson } from "./fmt";

type PairRow = Pair & { kalshiTitle: string | null; kalshiYesSubTitle: string | null; polyQuestion: string | null };

export default function PairsTab() {
  const { data, error, mutate } = useSWR<{ pairs: PairRow[] }>("/api/pairs", fetcher);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "confirmed" | "rejected">("confirmed");
  const fileRef = useRef<HTMLInputElement>(null);

  const remove = async (id: number) => {
    if (!confirm(`Remove pair #${id}? It may reappear as a candidate.`)) return;
    const res = await fetch(`/api/pairs/${id}`, { method: "DELETE" });
    setMsg(res.ok ? `Removed #${id}` : `Delete failed (${res.status})`);
    mutate();
  };

  const importFile = async (file: File) => {
    setMsg("Importing…");
    try {
      const body = JSON.parse(await file.text());
      const r = await postJson<{ imported: number; failed: Array<{ index: number; errors?: string[] }> }>("/api/pairs/import", body);
      setMsg(
        `Imported ${r.imported}.` +
          (r.failed.length ? ` Failed ${r.failed.length}: ${r.failed.map((f) => `#${f.index} ${f.errors?.join(", ")}`).join("; ")}` : ""),
      );
      mutate();
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const rows = (data?.pairs ?? []).filter((p) => filter === "all" || p.status === filter);
  return (
    <>
      <div className="panel controls">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
        <a href="/api/pairs/export">
          <button>Export JSON</button>
        </a>
        <label className="row" style={{ flexDirection: "row" }}>
          <button onClick={() => fileRef.current?.click()}>Import JSON…</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
        </label>
        {msg && <span className="small">{msg}</span>}
      </div>
      <div className="panel table-wrap">
        {error && <p className="error">{(error as Error).message}</p>}
        {data && rows.length === 0 && <p className="muted">No pairs.</p>}
        {rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Kalshi</th>
                <th>Polymarket</th>
                <th>Mapping</th>
                <th>Category</th>
                <th>Reviewed</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td>
                    <span className={`pill ${p.status === "confirmed" ? "pos" : "neg"}`}>{p.status}</span>
                  </td>
                  <td>
                    {p.kalshiTitle ?? <span className="muted">(not cached)</span>}
                    {p.kalshiYesSubTitle && <div className="small">YES = {p.kalshiYesSubTitle}</div>}
                    <div className="muted small mono">{p.kalshiTicker}</div>
                  </td>
                  <td>
                    {p.polyQuestion ?? <span className="muted">(not cached)</span>}
                    <div className="muted small mono">{p.polyMarketId}</div>
                  </td>
                  <td className="small">
                    {p.status === "confirmed" ? (
                      <>
                        YES ⇔ “{p.polyOutcomeForKalshiYes}”
                        <br />
                        NO ⇔ “{p.polyOutcomeForKalshiNo}”
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{p.category ?? "—"}</td>
                  <td className="small">
                    {p.confirmedBy}
                    <div className="muted">{date(p.confirmedAt)}</div>
                  </td>
                  <td className="small">{p.notes}</td>
                  <td>
                    <button className="danger" onClick={() => remove(p.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
