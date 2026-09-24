import { ensureStarted, json } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { marketCounts, recentScans } from "@/lib/db";
import { health } from "@/lib/http";
import { state } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureStarted();
  const c = getConfig();
  return json({
    venues: [health.kalshi, health.polymarket],
    scanner: {
      pollerStarted: state.pollerStarted,
      scanning: state.scanning,
      lastScanAt: state.lastScanAt,
      lastScanDurationMs: state.lastScanDurationMs,
      lastScanError: state.lastScanError,
      refreshing: state.refreshing,
      lastRefreshAt: state.lastRefreshAt,
      lastRefreshError: state.lastRefreshError,
      lastRefreshCounts: state.lastRefreshCounts,
    },
    cachedMarkets: marketCounts(),
    recentScans: recentScans(10),
    config: {
      pollIntervalMs: c.pollIntervalMs,
      stalenessMs: c.stalenessMs,
      kalshiRequestsPerSecond: c.kalshiRequestsPerSecond,
      polyRequestsPerSecond: c.polyRequestsPerSecond,
      minEdgePerContract: c.minEdgePerContract.toString(),
      kalshiFeeMultipliers: Object.fromEntries(Object.entries(c.kalshiFeeMultipliers).map(([k, v]) => [k, v.toString()])),
    },
  });
}
