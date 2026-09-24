import { ensureStarted, json, serverError } from "@/lib/api";
import { refreshMarkets, state } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/markets/refresh — re-pull both venues' open-market catalogs. */
export async function POST() {
  ensureStarted();
  if (state.refreshing) return json({ status: "already running" }, { status: 409 });
  try {
    const counts = await refreshMarkets();
    return json({ counts, error: state.lastRefreshError });
  } catch (err) {
    return serverError(err);
  }
}
