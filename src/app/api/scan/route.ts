import { ensureStarted, json, serverError } from "@/lib/api";
import { scanOnce } from "@/lib/scanner";

export const dynamic = "force-dynamic";

/** POST /api/scan — run one scan now (no-op if one is in progress). */
export async function POST() {
  ensureStarted();
  try {
    const r = await scanOnce();
    return json({ opportunities: r.opportunities.length, skips: r.skips.length });
  } catch (err) {
    return serverError(err);
  }
}
