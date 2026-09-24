import { listPairs } from "@/lib/db";
import { pairToJson } from "@/lib/pairs";

export const dynamic = "force-dynamic";

/** GET /api/pairs/export — download every reviewed pair as JSON. */
export async function GET() {
  const body = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), pairs: listPairs().map(pairToJson) }, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="arb-pairs-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
