// Solana: listens to Helius for any transaction touching a tracked wallet,
// then reads the transaction to see what the wallet bought or sold.
const { WsRpc } = require('./wsrpc');
const { rpc, rateLimiter, sleep, log } = require('./util');
const { classify } = require('./swap');

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const TOKEN_ACCOUNT_RENT = 0.00203928; // SOL locked when a new token account is opened

function keyOf(k) {
  return typeof k === 'string' ? k : k.pubkey;
}

function uiAmount(b) {
  const t = b.uiTokenAmount || {};
  if (t.uiAmountString !== undefined) return Number(t.uiAmountString);
  if (t.amount !== undefined) return Number(t.amount) / 10 ** (t.decimals || 0);
  return Number(t.uiAmount || 0);
}

/**
 * Work out what one wallet did in a transaction (from getTransaction, jsonParsed).
 * Returns null when it isn't a buy/sell (plain transfers, airdrops, failed txs...).
 */
function parseSolanaTx(tx, wallet) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const meta = tx.meta;
  const keys = tx.transaction.message.accountKeys.map(keyOf);
  const loaded = meta.loadedAddresses;
  if (loaded && keys.length < meta.preBalances.length) {
    keys.push(...(loaded.writable || []), ...(loaded.readonly || []));
  }

  let nativeDelta = 0;
  const idx = keys.indexOf(wallet);
  if (idx >= 0) {
    nativeDelta = (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9;
    if (idx === 0) nativeDelta += (meta.fee || 0) / 1e9; // network fee is not part of the trade
  }

  const deltas = new Map();
  const preIdx = new Set();
  const postIdx = new Set();
  for (const b of meta.preTokenBalances || []) {
    if (b.owner !== wallet) continue;
    preIdx.add(b.accountIndex);
    deltas.set(b.mint, (deltas.get(b.mint) || 0) - uiAmount(b));
  }
  for (const b of meta.postTokenBalances || []) {
    if (b.owner !== wallet) continue;
    postIdx.add(b.accountIndex);
    deltas.set(b.mint, (deltas.get(b.mint) || 0) + uiAmount(b));
  }
  // Opening/closing a token account moves a small refundable deposit; don't count it as spent.
  if (idx === 0) {
    for (const i of postIdx) if (!preIdx.has(i)) nativeDelta += TOKEN_ACCOUNT_RENT;
    for (const i of preIdx) if (!postIdx.has(i)) nativeDelta -= TOKEN_ACCOUNT_RENT;
  }
  for (const [m, d] of deltas) if (Math.abs(d) < 1e-12) deltas.delete(m);

  const result = classify('solana', nativeDelta, deltas);
  if (!result) return null;
  return {
    ...result,
    chain: 'solana',
    wallet,
    txId: tx.transaction.signatures[0],
    time: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
  };
}

class SolanaWatcher {
  constructor({ apiKey, getAddresses, onSwap, onStatus, backfillPerWallet = 5, pollMinutes = 10 }) {
    this.apiKey = apiKey;
    this.httpUrl = process.env.SOLANA_HTTP_URL || `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    this.wsUrl = process.env.SOLANA_WSS_URL || `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    this.getAddresses = getAddresses;
    this.onSwap = onSwap;
    this.onStatus = onStatus;
    this.backfillPerWallet = backfillPerWallet;
    this.pollMinutes = pollMinutes;
    this.limiter = rateLimiter(8); // Helius free tier: 10 requests/second
    this.seen = new Set();
    this.lastSig = new Map();
    this.subs = new Map(); // subscription id -> wallet
    this.ws = null;
  }

  async start() {
    this.ws = new WsRpc({
      name: 'Solana',
      url: this.wsUrl,
      keepaliveMethod: 'getHealth',
      onOpen: (c) => this._subscribeAll(c),
      onNotification: (m) => this._onNotification(m),
      onStatus: (s, detail) => this.onStatus(s, detail),
    });
    this.ws.start();
    this._backfill().catch((e) => log(`Solana history load failed: ${e.message}`));
    if (this.pollMinutes > 0) {
      setInterval(() => this._poll().catch(() => {}), this.pollMinutes * 60000).unref();
    }
  }

  // Call after wallets were added/removed.
  refresh() {
    if (this.ws) this.ws.restart();
    this._backfill().catch(() => {});
  }

  async _subscribeAll(conn) {
    this.subs.clear();
    const addrs = this.getAddresses();
    for (const a of addrs) {
      const id = await conn.request('logsSubscribe', [{ mentions: [a] }, { commitment: 'confirmed' }]);
      this.subs.set(id, a);
    }
    log(`Solana: watching ${addrs.length} wallet(s) live`);
    // Catch anything missed while disconnected.
    this._poll().catch(() => {});
  }

  _onNotification(m) {
    if (m.method !== 'logsNotification') return;
    const wallet = this.subs.get(m.params.subscription);
    const v = m.params.result && m.params.result.value;
    if (!wallet || !v || v.err) return;
    // Buys and sells always move tokens; skip plain SOL transfers to save API credits.
    const logs = v.logs || [];
    if (!logs.some((l) => TOKEN_PROGRAMS.some((p) => l.includes(p)))) return;
    this._handleSignature(v.signature, wallet, false);
  }

  async _handleSignature(sig, wallet, backfill) {
    const k = `${sig}:${wallet}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    if (this.seen.size > 50000) this.seen = new Set([...this.seen].slice(-20000));
    try {
      let tx = null;
      for (let i = 0; i < 6 && !tx; i++) {
        tx = await rpc(this.httpUrl, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }], this.limiter);
        if (!tx) await sleep(1500);
      }
      const swap = parseSolanaTx(tx, wallet);
      if (swap) await this.onSwap(swap, { backfill });
    } catch (e) {
      this.seen.delete(k);
      log(`Solana: could not read tx ${sig.slice(0, 8)}...: ${e.message}`);
    }
  }

  async _signatures(addr, opts) {
    return (await rpc(this.httpUrl, 'getSignaturesForAddress', [addr, { commitment: 'confirmed', ...opts }], this.limiter)) || [];
  }

  // On start: show each wallet's last few trades so the feed isn't empty.
  async _backfill() {
    for (const addr of this.getAddresses()) {
      if (this.lastSig.has(addr)) continue;
      try {
        const sigs = await this._signatures(addr, { limit: this.backfillPerWallet });
        if (sigs[0]) this.lastSig.set(addr, sigs[0].signature);
        for (const s of sigs.reverse()) if (!s.err) await this._handleSignature(s.signature, addr, true);
      } catch (e) {
        log(`Solana: history for ${addr.slice(0, 6)}... failed: ${e.message}`);
      }
    }
  }

  // Safety net: every few minutes, ask for anything newer than what we last saw.
  async _poll() {
    for (const addr of this.getAddresses()) {
      const until = this.lastSig.get(addr);
      if (!until) continue;
      try {
        const sigs = await this._signatures(addr, { limit: 25, until });
        if (sigs[0]) this.lastSig.set(addr, sigs[0].signature);
        for (const s of sigs.reverse()) if (!s.err) await this._handleSignature(s.signature, addr, false);
      } catch {}
    }
  }

  // Name/ticker for brand-new tokens Dexscreener hasn't indexed yet.
  async tokenMetadata(mint) {
    try {
      const a = await rpc(this.httpUrl, 'getAsset', { id: mint }, this.limiter);
      const md = (a && a.content && a.content.metadata) || {};
      const symbol = md.symbol || (a && a.token_info && a.token_info.symbol) || null;
      if (!md.name && !symbol) return null;
      return { name: md.name || symbol, symbol };
    } catch {
      return null;
    }
  }
}

module.exports = { SolanaWatcher, parseSolanaTx };
