// Turns "what went in and out of a wallet in one transaction" into a BUY or SELL.
//
// Quote currencies (what traders pay with): the chain's native coin (SOL/ETH/BNB,
// including its wrapped version) and major stablecoins. Receiving any other token
// while paying something = BUY. Sending a token and getting quote currency back = SELL.

const QUOTES = {
  solana: {
    native: ['So11111111111111111111111111111111111111112'], // wrapped SOL
    stables: [
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // USD1
    ],
  },
  base: {
    native: ['0x4200000000000000000000000000000000000006'], // WETH
    stables: [
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
      '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // USDT
    ],
  },
  bnb: {
    native: ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'], // WBNB
    stables: [
      '0x55d398326f99059ff775485246999027b3197955', // USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
      '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
      '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', // USD1
    ],
  },
};

const NATIVE_SYMBOL = { solana: 'SOL', base: 'ETH', bnb: 'BNB' };

function norm(chain, a) {
  return chain === 'solana' ? a : String(a).toLowerCase();
}

function isNativeQuote(chain, a) {
  return QUOTES[chain].native.includes(norm(chain, a));
}

function isStable(chain, a) {
  return QUOTES[chain].stables.includes(norm(chain, a));
}

const NATIVE_DUST = { solana: 0.00001, base: 0.0000001, bnb: 0.000001 };

/**
 * @param chain 'solana' | 'base' | 'bnb'
 * @param nativeDelta  change in native coin (SOL/ETH/BNB), fees already removed
 * @param tokenDeltas  Map(tokenAddress -> signed change, in whole tokens)
 * @returns null (not a trade) or { side, token, tokenAmount, nativeAmount, stableUsd, paidWith }
 */
function classify(chain, nativeDelta, tokenDeltas) {
  let native = nativeDelta || 0;
  let stable = 0;
  const received = [];
  const sent = [];
  for (const [addr, d] of tokenDeltas) {
    if (!d) continue;
    if (isNativeQuote(chain, addr)) native += d;
    else if (isStable(chain, addr)) stable += d;
    else if (d > 0) received.push({ address: addr, amount: d });
    else sent.push({ address: addr, amount: -d });
  }
  const dust = NATIVE_DUST[chain];
  const nativeOut = native < -dust;
  const nativeIn = native > dust;
  const stableOut = stable < -0.01;
  const stableIn = stable > 0.01;

  if (received.length && (nativeOut || stableOut || sent.length)) {
    received.sort((a, b) => b.amount - a.amount);
    const r = received[0];
    return {
      side: 'buy',
      token: r.address,
      tokenAmount: r.amount,
      nativeAmount: nativeOut ? -native : 0,
      stableUsd: stableOut ? -stable : 0,
      // Token-for-token swap: remember what was given up so it can be priced.
      paidWith: !nativeOut && !stableOut && sent.length ? sent[0] : null,
    };
  }
  if (!received.length && sent.length && (nativeIn || stableIn)) {
    sent.sort((a, b) => b.amount - a.amount);
    const s = sent[0];
    return {
      side: 'sell',
      token: s.address,
      tokenAmount: s.amount,
      nativeAmount: nativeIn ? native : 0,
      stableUsd: stableIn ? stable : 0,
      paidWith: null,
    };
  }
  return null;
}

module.exports = { classify, QUOTES, NATIVE_SYMBOL, isNativeQuote, isStable };
