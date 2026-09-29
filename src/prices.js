// Token names, tickers and USD prices from Dexscreener (free, no API key).
const { fetchJson, rateLimiter, log } = require('./util');

const DEX_CHAIN = { solana: 'solana', base: 'base', bnb: 'bsc' };

// Wrapped native tokens, used to price SOL / ETH / BNB.
const WRAPPED_NATIVE = {
  solana: 'So11111111111111111111111111111111111111112',
  base: '0x4200000000000000000000000000000000000006',
  bnb: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
};

const limiter = rateLimiter(4); // Dexscreener allows ~300 req/min
const tokenCache = new Map(); // key chain:address -> { name, symbol, priceUsd, at }
const nativePrice = { solana: null, base: null, bnb: null };

function key(chain, address) {
  return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
}

function sameAddr(chain, a, b) {
  return chain === 'solana' ? a === b : String(a).toLowerCase() === String(b).toLowerCase();
}

// Pick the most liquid pair that has this token on either side.
function pickFromPairs(chain, address, pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  let best = null;
  let bestLiq = -1;
  for (const p of pairs) {
    const isBase = p.baseToken && sameAddr(chain, p.baseToken.address, address);
    const isQuote = p.quoteToken && sameAddr(chain, p.quoteToken.address, address);
    if (!isBase && !isQuote) continue;
    const liq = (p.liquidity && p.liquidity.usd) || 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = { p, isBase };
    }
  }
  if (!best) return null;
  const { p, isBase } = best;
  const tok = isBase ? p.baseToken : p.quoteToken;
  let priceUsd = null;
  const pu = Number(p.priceUsd);
  const pn = Number(p.priceNative);
  if (isBase && pu > 0) priceUsd = pu;
  else if (!isBase && pu > 0 && pn > 0) priceUsd = pu / pn; // price of the quote side
  return {
    name: tok.name || null,
    symbol: tok.symbol || null,
    priceUsd,
    pairUrl: p.url || null,
    marketCap: p.marketCap || p.fdv || null,
  };
}

async function getTokenInfo(chain, address, { maxAgeMs = 30000 } = {}) {
  const k = key(chain, address);
  const cached = tokenCache.get(k);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached;
  try {
    await limiter();
    const pairs = await fetchJson(`${process.env.DEXSCREENER_API || 'https://api.dexscreener.com'}/tokens/v1/${DEX_CHAIN[chain]}/${address}`);
    const info = pickFromPairs(chain, address, pairs);
    if (info) {
      const merged = { ...(cached || {}), ...info, at: Date.now() };
      tokenCache.set(k, merged);
      return merged;
    }
  } catch (e) {
    log(`Dexscreener lookup failed for ${chain} ${address}: ${e.message}`);
  }
  return cached || null;
}

// Remember a name/symbol found elsewhere (onchain metadata) for brand-new tokens.
function rememberToken(chain, address, info) {
  const k = key(chain, address);
  tokenCache.set(k, { ...(tokenCache.get(k) || {}), ...info, at: 0 });
}

async function refreshNativePrices() {
  for (const chain of Object.keys(WRAPPED_NATIVE)) {
    const info = await getTokenInfo(chain, WRAPPED_NATIVE[chain], { maxAgeMs: 0 });
    if (info && info.priceUsd) nativePrice[chain] = info.priceUsd;
  }
}

function startNativePriceLoop() {
  refreshNativePrices().catch(() => {});
  setInterval(() => refreshNativePrices().catch(() => {}), 60000).unref();
}

function getNativePrice(chain) {
  return nativePrice[chain];
}

function chartUrl(chain, address) {
  return `https://dexscreener.com/${DEX_CHAIN[chain]}/${address}`;
}

module.exports = {
  getTokenInfo,
  rememberToken,
  getNativePrice,
  startNativePriceLoop,
  refreshNativePrices,
  chartUrl,
  pickFromPairs,
  WRAPPED_NATIVE,
  _nativePrice: nativePrice,
};
