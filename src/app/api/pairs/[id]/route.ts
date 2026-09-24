import { badRequest, json } from "@/lib/api";
import { deletePair } from "@/lib/db";

export const dynamic = "force-dynamic";

/** DELETE /api/pairs/:id — forget a decision (the pair can then reappear as a candidate). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return badRequest("Invalid id");
  return deletePair(id) ? json({ ok: true }) : json({ error: "Not found" }, { status: 404 });
}
