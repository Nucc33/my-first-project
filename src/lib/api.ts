import { NextResponse } from "next/server";
import { startPoller } from "./scanner";

/** Every route calls this so the poller runs even if instrumentation didn't fire. */
export function ensureStarted(): void {
  startPoller();
}

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(message: string | string[]): NextResponse {
  return NextResponse.json({ error: Array.isArray(message) ? message.join("; ") : message }, { status: 400 });
}

export function serverError(err: unknown): NextResponse {
  return NextResponse.json({ error: (err as Error)?.message ?? String(err) }, { status: 500 });
}

/** Parse a non-negative decimal query param; returns undefined when absent, null when invalid. */
export function decParam(v: string | null): string | undefined | null {
  if (v === null || v.trim() === "") return undefined;
  return /^\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : null;
}
