/**
 * Throttled JSON fetcher with exponential backoff on HTTP 429 / 5xx, plus per-venue
 * health counters for the UI.
 */

export type Venue = "kalshi" | "polymarket";

export interface VenueHealth {
  venue: Venue;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  requests: number;
  errors: number;
  rateLimitHits: number;
}

const g = globalThis as unknown as { __arbHealth?: Record<Venue, VenueHealth> };
function blank(venue: Venue): VenueHealth {
  return { venue, lastSuccessAt: null, lastErrorAt: null, lastError: null, requests: 0, errors: 0, rateLimitHits: 0 };
}
export const health: Record<Venue, VenueHealth> = (g.__arbHealth ??= {
  kalshi: blank("kalshi"),
  polymarket: blank("polymarket"),
});

/** Evenly spaced request slots: at most `rps` request starts per second. */
export class Throttle {
  private next = 0;
  constructor(private rps: number) {}
  async wait(): Promise<void> {
    const interval = this.rps > 0 ? 1000 / this.rps : 0;
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + interval;
    if (slot > now) await sleep(slot - now);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
  }
}

export interface FetchJsonOptions {
  venue: Venue;
  throttle: Throttle;
  maxRetries: number;
  timeoutMs: number;
  init?: RequestInit;
}

export async function fetchJson<T = unknown>(url: string, o: FetchJsonOptions): Promise<T> {
  const h = health[o.venue];
  let attempt = 0;
  for (;;) {
    await o.throttle.wait();
    h.requests++;
    let res: Response;
    try {
      res = await fetch(url, {
        ...o.init,
        headers: { accept: "application/json", ...(o.init?.headers ?? {}) },
        signal: AbortSignal.timeout(o.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if (attempt < o.maxRetries) {
        await sleep(backoffMs(attempt++));
        continue;
      }
      recordError(o.venue, `${url}: ${(err as Error).message}`);
      throw err;
    }

    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429) h.rateLimitHits++;
      if (attempt < o.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
        attempt++;
        await sleep(wait);
        continue;
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `${o.venue} ${res.status} ${url}: ${body.slice(0, 200)}`;
      recordError(o.venue, msg);
      throw new HttpError(msg, res.status, body);
    }
    try {
      const json = (await res.json()) as T;
      h.lastSuccessAt = new Date().toISOString();
      return json;
    } catch (err) {
      recordError(o.venue, `${url}: invalid JSON`);
      throw err;
    }
  }
}

/** 0.5s, 1s, 2s, 4s … capped at 30s, with ±20% jitter. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function recordError(venue: Venue, message: string): void {
  const h = health[venue];
  h.errors++;
  h.lastErrorAt = new Date().toISOString();
  h.lastError = message.slice(0, 500);
}
