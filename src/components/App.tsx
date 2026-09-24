"use client";

import { useEffect, useState } from "react";
import HealthTab from "./HealthTab";
import Limitations from "./Limitations";
import OpportunitiesTab from "./OpportunitiesTab";
import PairsTab from "./PairsTab";
import ReviewTab from "./ReviewTab";

const TABS = [
  { id: "opps", label: "Opportunities" },
  { id: "review", label: "Review" },
  { id: "pairs", label: "Pairs" },
  { id: "health", label: "Health" },
  { id: "about", label: "Limitations" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("opps");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("arb.tab") as TabId | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const select = (id: TabId) => {
    setTab(id);
    try {
      localStorage.setItem("arb.tab", id);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="banner" role="alert">
        Read-only scanner. Not financial advice. Verify both markets&apos; rules before trading. Quotes can move before you fill both legs.
      </div>
      <div className="wrap">
        <header className="top">
          <h1>Kalshi ↔ Polymarket Arbitrage Scanner</h1>
          <span className="muted small">Indicative only · places no orders · public market data</span>
        </header>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => select(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab === "opps" && <OpportunitiesTab />}
        {tab === "review" && <ReviewTab />}
        {tab === "pairs" && <PairsTab />}
        {tab === "health" && <HealthTab />}
        {tab === "about" && <Limitations />}
      </div>
    </>
  );
}
