import { badRequest, ensureStarted, json } from "@/lib/api";
import { savePairDecision } from "@/lib/pairService";
import { pairInputFromJson } from "@/lib/pairs";

export const dynamic = "force-dynamic";

/** POST /api/pairs/import — body is an export file ({ pairs: [...] }) or a bare array. */
export async function POST(req: Request) {
  ensureStarted();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be JSON");
  }
  const items = Array.isArray(body) ? body : (body as { pairs?: unknown[] })?.pairs;
  if (!Array.isArray(items)) return badRequest("Expected an array of pairs or { pairs: [...] }");
  const results: Array<{ index: number; ok: boolean; errors?: string[] }> = [];
  for (const [index, raw] of items.entries()) {
    try {
      const { errors } = await savePairDecision(pairInputFromJson(raw));
      results.push(errors.length ? { index, ok: false, errors } : { index, ok: true });
    } catch (err) {
      results.push({ index, ok: false, errors: [(err as Error).message] });
    }
  }
  return json({ imported: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
}
