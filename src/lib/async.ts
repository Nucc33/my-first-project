/**
 * Let other requests run. The server is single-threaded, so long synchronous loops (saving or
 * scoring tens of thousands of markets) must pause regularly or every page and API call stalls.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
