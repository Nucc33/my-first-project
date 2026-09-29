// Small shared helpers. No external dependencies.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Decode a base58 string to bytes (returns null if invalid).
function base58Decode(str) {
  if (typeof str !== 'string' || !str.length) return null;
  const bytes = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return bytes.reverse();
}

function isSolanaAddress(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  const b = base58Decode(s);
  return !!b && b.length === 32;
}

function isEvmAddress(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Limits how many requests per second go to a provider (free tiers are strict).
function rateLimiter(perSecond) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async function wait() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

// JSON-RPC over HTTP (Solana + EVM both use this format).
async function rpc(url, method, params, limiter) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (limiter) await limiter();
    try {
      const body = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (body && body.error) {
        const err = new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
        err.rpc = body.error;
        throw err;
      }
      return body ? body.result : null;
    } catch (e) {
      const retryable = e.status === 429 || e.status >= 500 || e.name === 'AbortError' || e.cause;
      if (!retryable || attempt === 3) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}

function log(...args) {
  const t = new Date().toLocaleTimeString();
  console.log(`[${t}]`, ...args);
}

module.exports = { base58Decode, isSolanaAddress, isEvmAddress, sleep, rateLimiter, fetchJson, rpc, log };
