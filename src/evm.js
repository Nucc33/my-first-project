// Base and BNB Chain: listens for token transfers into/out of tracked wallets,
// then reads the whole transaction to see what was bought or sold.
const { WsRpc } = require('./wsrpc');
const { rpc, rateLimiter, log } = require('./util');
const { classify, QUOTES } = require('./swap');

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WETH_DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
const WETH_WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

const pad = (addr) => '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
const unpad = (topic) => '0x' + topic.slice(26).toLowerCase();

function big(hex) {
  try { return BigInt(hex && hex !== '0x' ? hex : 0); } catch { return 0n; }
}

function toNumber(raw, decimals) {
  // Keep precision for big 18-decimal numbers before converting to a JS number.
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = Number(abs % base) / Number(base);
  const n = Number(whole) + frac;
  return neg ? -n : n;
}

/**
 * Work out what one wallet did in a transaction.
 * @param receipt  eth_getTransactionReceipt result
 * @param tx       eth_getTransactionByHash result
 * @param decimals Map(tokenAddress -> decimals)
 */
function parseEvmTx(chain, receipt, tx, wallet, decimals) {
  if (!receipt || receipt.status === '0x0') return null;
  wallet = wallet.toLowerCase();
  const wrapped = QUOTES[chain].native[0];
  const raw = new Map();
  let deposits = 0n;
  let withdrawals = 0n;
  for (const l of receipt.logs || []) {
    const t = l.topics || [];
    const addr = String(l.address).toLowerCase();
    if (t[0] === TRANSFER && t.length === 3) {
      const from = unpad(t[1]);
      const to = unpad(t[2]);
      const amt = big(l.data);
      if (to === wallet) raw.set(addr, (raw.get(addr) || 0n) + amt);
      if (from === wallet) raw.set(addr, (raw.get(addr) || 0n) - amt);
    } else if (addr === wrapped && t[0] === WETH_DEPOSIT) {
      deposits += big(l.data);
    } else if (addr === wrapped && t[0] === WETH_WITHDRAWAL) {
      withdrawals += big(l.data);
    }
  }
  const deltas = new Map();
  for (const [addr, v] of raw) {
    if (v === 0n) continue;
    const d = decimals.get(addr);
    deltas.set(addr, toNumber(v, d === undefined ? 18 : d));
  }

  let nativeDelta = 0;
  if (tx && String(tx.from).toLowerCase() === wallet) nativeDelta -= toNumber(big(tx.value), 18);

  let result = classify(chain, nativeDelta, deltas);

  // Smart-contract wallets and "sell for ETH" routes move native coins in ways that
  // don't show up as transfers. Fall back to the wrap/unwrap amounts in that case.
  if (!result && deltas.size) {
    if (withdrawals > 0n) result = classify(chain, nativeDelta + toNumber(withdrawals, 18), deltas);
    if (!result && deposits > 0n) result = classify(chain, nativeDelta - toNumber(deposits, 18), deltas);
  }
  if (!result) return null;
  return { ...result, chain, wallet, txId: receipt.transactionHash, time: Date.now() };
}

// Which token addresses in a receipt touch this wallet (so we know which decimals to fetch).
function tokensTouching(receipt, wallet) {
  wallet = wallet.toLowerCase();
  const out = new Set();
  for (const l of receipt.logs || []) {
    const t = l.topics || [];
    if (t[0] === TRANSFER && t.length === 3 && (unpad(t[1]) === wallet || unpad(t[2]) === wallet)) {
      out.add(String(l.address).toLowerCase());
    }
  }
  return [...out];
}

function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const h = hex.slice(2);
  try {
    if (h.length === 64) {
      return Buffer.from(h, 'hex').toString('utf8').replace(/\0+$/, '') || null; // old bytes32 tokens
    }
    const len = parseInt(h.slice(64, 128), 16);
    return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8') || null;
  } catch {
    return null;
  }
}

const ENDPOINTS = {
  base: (key) => ({ http: `https://base-mainnet.g.alchemy.com/v2/${key}`, ws: `wss://base-mainnet.g.alchemy.com/v2/${key}` }),
  bnb: (key) => ({ http: `https://bnb-mainnet.g.alchemy.com/v2/${key}`, ws: `wss://bnb-mainnet.g.alchemy.com/v2/${key}` }),
};

class EvmWatcher {
  constructor({ chain, httpUrl, wsUrl, getAddresses, onSwap, onStatus }) {
    this.chain = chain;
    this.name = chain === 'base' ? 'Base' : 'BNB';
    this.httpUrl = httpUrl;
    this.wsUrl = wsUrl;
    this.getAddresses = getAddresses;
    this.onSwap = onSwap;
    this.onStatus = onStatus;
    this.limiter = rateLimiter(10);
    // Stablecoins use 6 decimals on Base and 18 on BNB Chain.
    this.decimals = new Map(QUOTES[chain].stables.map((a) => [a, chain === 'base' ? 6 : 18]));
    this.decimals.set(QUOTES[chain].native[0], 18);
    this.pendingTx = new Map(); // tx hash -> Set(wallets), batched for a moment
    this.seen = new Set();
    this.lastBlock = null;
  }

  start() {
    this.ws = new WsRpc({
      name: this.name,
      url: this.wsUrl,
      keepaliveMethod: 'eth_blockNumber',
      onOpen: (c) => this._subscribe(c),
      onNotification: (m) => this._onNotification(m),
      onStatus: (s, d) => this.onStatus(s, d),
    });
    this.ws.start();
  }

  refresh() {
    if (this.ws) this.ws.restart();
  }

  async _subscribe(conn) {
    const addrs = this.getAddresses();
    const topics = addrs.map(pad);
    this.watched = new Set(addrs.map((a) => a.toLowerCase()));
    await conn.request('eth_subscribe', ['logs', { topics: [TRANSFER, null, topics] }]); // tokens in
    await conn.request('eth_subscribe', ['logs', { topics: [TRANSFER, topics] }]); // tokens out
    log(`${this.name}: watching ${addrs.length} wallet(s) live`);
    await this._catchUp(topics).catch((e) => log(`${this.name}: catch-up skipped (${e.message})`));
  }

  // After a reconnect, look back over the blocks we missed.
  async _catchUp(topics) {
    const latest = Number(await rpc(this.httpUrl, 'eth_blockNumber', [], this.limiter));
    if (this.lastBlock === null) {
      this.lastBlock = latest;
      return;
    }
    let from = Math.max(this.lastBlock + 1, latest - 400);
    while (from <= latest) {
      const to = Math.min(from + 9, latest); // free plans allow small block ranges
      const range = { fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) };
      const a = await rpc(this.httpUrl, 'eth_getLogs', [{ ...range, topics: [TRANSFER, null, topics] }], this.limiter);
      const b = await rpc(this.httpUrl, 'eth_getLogs', [{ ...range, topics: [TRANSFER, topics] }], this.limiter);
      for (const l of [...(a || []), ...(b || [])]) this._queueLog(l);
      from = to + 1;
    }
    this.lastBlock = latest;
  }

  _onNotification(m) {
    if (m.method !== 'eth_subscription') return;
    const l = m.params && m.params.result;
    if (l && !l.removed) this._queueLog(l);
  }

  _queueLog(l) {
    const t = l.topics || [];
    if (t.length !== 3) return;
    const bn = parseInt(l.blockNumber, 16);
    if (bn && (this.lastBlock === null || bn > this.lastBlock)) this.lastBlock = bn;
    const hit = [unpad(t[1]), unpad(t[2])].filter((a) => this.watched && this.watched.has(a));
    if (!hit.length) return;
    const hash = l.transactionHash;
    const isNew = !this.pendingTx.has(hash);
    const set = this.pendingTx.get(hash) || new Set();
    hit.forEach((a) => set.add(a));
    this.pendingTx.set(hash, set);
    // A swap emits several logs at once; wait a moment and handle the tx once.
    if (isNew) setTimeout(() => this._process(hash), 1200);
  }

  async _process(hash) {
    const wallets = this.pendingTx.get(hash);
    this.pendingTx.delete(hash);
    if (!wallets || this.seen.has(hash)) return;
    this.seen.add(hash);
    if (this.seen.size > 50000) this.seen = new Set([...this.seen].slice(-20000));
    try {
      const [receipt, tx] = await Promise.all([
        rpc(this.httpUrl, 'eth_getTransactionReceipt', [hash], this.limiter),
        rpc(this.httpUrl, 'eth_getTransactionByHash', [hash], this.limiter),
      ]);
      if (!receipt) throw new Error('receipt not ready');
      for (const w of wallets) {
        for (const tok of tokensTouching(receipt, w)) await this._decimals(tok);
        const swap = parseEvmTx(this.chain, receipt, tx, w, this.decimals);
        if (swap) await this.onSwap(swap, { backfill: false });
      }
    } catch (e) {
      this.seen.delete(hash);
      log(`${this.name}: could not read tx ${hash.slice(0, 10)}...: ${e.message}`);
    }
  }

  async _decimals(token) {
    if (this.decimals.has(token)) return this.decimals.get(token);
    let d = 18;
    try {
      const r = await rpc(this.httpUrl, 'eth_call', [{ to: token, data: '0x313ce567' }, 'latest'], this.limiter);
      const n = Number(big(r));
      if (n >= 0 && n <= 36) d = n;
    } catch {}
    this.decimals.set(token, d);
    return d;
  }

  // Name/ticker straight from the token contract, for tokens Dexscreener doesn't know yet.
  async tokenMetadata(token) {
    try {
      const [n, s] = await Promise.all([
        rpc(this.httpUrl, 'eth_call', [{ to: token, data: '0x06fdde03' }, 'latest'], this.limiter),
        rpc(this.httpUrl, 'eth_call', [{ to: token, data: '0x95d89b41' }, 'latest'], this.limiter),
      ]);
      const name = decodeString(n);
      const symbol = decodeString(s);
      if (!name && !symbol) return null;
      return { name: name || symbol, symbol: symbol || name };
    } catch {
      return null;
    }
  }
}

module.exports = { EvmWatcher, parseEvmTx, decodeString, ENDPOINTS, pad, TRANSFER };
