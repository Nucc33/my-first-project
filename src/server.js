// Wallet Tracker: local dashboard + live blockchain watchers.
// Start with:  npm start     then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');
const hadEnv = loadEnv();

const { Store } = require('./store');
const { SolanaWatcher } = require('./solana');
const { EvmWatcher, ENDPOINTS } = require('./evm');
const prices = require('./prices');
const { NATIVE_SYMBOL } = require('./swap');
const { resolveAll, configuredProviders } = require('./resolve');
const { log } = require('./util');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const store = new Store();
const clients = new Set();
const TX_URL = {
  solana: (id) => `https://solscan.io/tx/${id}`,
  base: (id) => `https://basescan.org/tx/${id}`,
  bnb: (id) => `https://bscscan.com/tx/${id}`,
};

const status = {
  solana: { state: 'off', detail: 'Add HELIUS_API_KEY to .env' },
  base: { state: 'off', detail: 'Add ALCHEMY_API_KEY to .env' },
  bnb: { state: 'off', detail: 'Add ALCHEMY_API_KEY to .env' },
  resolver: { running: false, message: '' },
};

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function setStatus(chain, state, detail = '') {
  status[chain] = { state, detail };
  broadcast('status', status);
}

// ---------- turning a raw swap into a feed row ----------

const watchers = {};

async function tokenLabel(chain, address) {
  const info = await prices.getTokenInfo(chain, address);
  if (info && info.symbol) return info;
  const w = watchers[chain];
  const md = w && (await w.tokenMetadata(address));
  if (md) prices.rememberToken(chain, address, md);
  return { ...(info || {}), ...(md || {}) };
}

async function priceTrade(swap) {
  const chain = swap.chain;
  const native = prices.getNativePrice(chain);
  const info = await tokenLabel(chain, swap.token);
  let usd = swap.stableUsd + (native ? swap.nativeAmount * native : 0);
  let approx = !native && swap.nativeAmount > 0;
  if (!usd && swap.paidWith) {
    const other = await prices.getTokenInfo(chain, swap.paidWith.address);
    if (other && other.priceUsd) usd = swap.paidWith.amount * other.priceUsd;
    approx = true;
  }
  if (!usd && info && info.priceUsd) {
    usd = swap.tokenAmount * info.priceUsd;
    approx = true;
  }
  // Show the amount in SOL/ETH/BNB too, converting stablecoin buys at the current price.
  let nativeAmount = swap.nativeAmount + (native && swap.stableUsd ? swap.stableUsd / native : 0);
  if (!nativeAmount && native && usd) nativeAmount = usd / native;
  return {
    token: {
      address: swap.token,
      name: (info && info.name) || null,
      symbol: (info && info.symbol) || null,
      marketCap: (info && info.marketCap) || null,
    },
    usd: usd || null,
    native: nativeAmount || null,
    nativeSymbol: NATIVE_SYMBOL[chain],
    paidWithStable: swap.stableUsd > 0,
    approx,
  };
}

async function onSwap(swap, { backfill }) {
  const owners = store.walletsFor(swap.chain, swap.wallet);
  if (!owners.length) return;
  const w = owners[0];
  const id = `${swap.chain}:${swap.txId}:${swap.wallet}`;
  if (store.hasTrade(id)) return;
  const priced = await priceTrade(swap);
  const trade = {
    id,
    chain: swap.chain,
    side: swap.side,
    time: swap.time,
    seenAt: Date.now(),
    walletId: w.id,
    nickname: w.nickname,
    rank: w.rank,
    wallet: swap.wallet,
    tokenAmount: swap.tokenAmount,
    ...priced,
    txUrl: TX_URL[swap.chain](swap.txId),
    chartUrl: prices.chartUrl(swap.chain, swap.token),
    history: !!backfill,
  };
  if (!store.addTrade(trade)) return;
  broadcast('trade', trade);
  if (!backfill) {
    const t = trade.token.symbol ? '$' + trade.token.symbol : swap.token.slice(0, 6);
    const usd = trade.usd ? `$${Math.round(trade.usd).toLocaleString()}` : '?';
    log(`${trade.side.toUpperCase()}  ${w.nickname}  ${t}  ${usd}  (${swap.chain})`);
  }
  // Brand-new tokens often have no name/price for a few seconds; try again shortly.
  if (!trade.token.symbol || !trade.usd) {
    setTimeout(async () => {
      const again = await priceTrade(swap);
      const patched = store.patchTrade(id, again);
      if (patched) broadcast('update', patched);
    }, 20000);
  }
}

// ---------- chain watchers ----------

function solAddresses() {
  return [...new Set(store.wallets.map((w) => w.sol).filter(Boolean))];
}
function evmAddresses() {
  return [...new Set(store.wallets.map((w) => w.evm).filter(Boolean))];
}

function startWatchers() {
  const helius = (process.env.HELIUS_API_KEY || '').trim();
  if (helius) {
    watchers.solana = new SolanaWatcher({
      apiKey: helius,
      getAddresses: solAddresses,
      onSwap,
      onStatus: (s, d) => setStatus('solana', solAddresses().length ? s : 'idle', solAddresses().length ? d : 'No Solana wallets yet'),
      backfillPerWallet: Number(process.env.HISTORY_PER_WALLET || 5),
      pollMinutes: Number(process.env.SAFETY_POLL_MINUTES || 10),
    });
    if (solAddresses().length) watchers.solana.start();
    else setStatus('solana', 'idle', 'No Solana wallets yet');
  }

  const alchemy = (process.env.ALCHEMY_API_KEY || '').trim();
  for (const chain of ['base', 'bnb']) {
    const envWs = process.env[`${chain.toUpperCase()}_WSS_URL`];
    const envHttp = process.env[`${chain.toUpperCase()}_HTTP_URL`];
    if (process.env[`DISABLE_${chain.toUpperCase()}`] === '1') {
      setStatus(chain, 'off', 'Turned off in .env');
      continue;
    }
    if (!alchemy && !(envWs && envHttp)) continue;
    const ep = alchemy ? ENDPOINTS[chain](alchemy) : {};
    watchers[chain] = new EvmWatcher({
      chain,
      httpUrl: envHttp || ep.http,
      wsUrl: envWs || ep.ws,
      getAddresses: evmAddresses,
      onSwap,
      onStatus: (s, d) => setStatus(chain, s, d),
    });
    if (evmAddresses().length) watchers[chain].start();
    else setStatus(chain, 'idle', 'No EVM wallets yet');
  }
}

let refreshTimer = null;
function walletsChanged() {
  broadcast('wallets', store.wallets);
  // Wait a moment so several quick edits only reconnect once.
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const s = watchers.solana;
    if (s) {
      if (!solAddresses().length) { s.ws && s.ws.stop(); setStatus('solana', 'idle', 'No Solana wallets yet'); }
      else if (!s.ws) s.start();
      else s.refresh();
    }
    for (const chain of ['base', 'bnb']) {
      const w = watchers[chain];
      if (!w) continue;
      if (!evmAddresses().length) { w.ws && w.ws.stop(); setStatus(chain, 'idle', 'No EVM wallets yet'); }
      else if (!w.ws) w.start();
      else w.refresh();
    }
  }, 1500);
}

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Bad JSON')); }
    });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function runResolver(all) {
  if (status.resolver.running) return;
  status.resolver = { running: true, message: 'Starting lookup...' };
  broadcast('status', status);
  try {
    const s = await resolveAll(store, {
      all,
      onProgress: (i, n, w) => {
        status.resolver = { running: true, message: `Looking up ${i}/${n}: ${w.nickname}` };
        broadcast('status', status);
        broadcast('wallets', store.wallets);
      },
    });
    status.resolver = {
      running: false,
      message: `Done. Found ${s.resolved.length}, not found ${s.notFound.length}, errors ${s.failed.length}.`,
    };
  } catch (e) {
    status.resolver = { running: false, message: e.message };
  }
  broadcast('status', status);
  walletsChanged();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, {
        wallets: store.wallets,
        settings: store.settings,
        feed: store.feed.slice(0, 500),
        status,
        resolverReady: configuredProviders().length > 0,
      });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const s = store.updateSettings(await readBody(req));
      broadcast('settings', s);
      return send(res, 200, s);
    }
    if (p === '/api/wallets' && req.method === 'POST') {
      const w = store.addWallet(await readBody(req));
      walletsChanged();
      return send(res, 200, w);
    }
    const m = p.match(/^\/api\/wallets\/([a-f0-9]+)$/);
    if (m && req.method === 'PATCH') {
      const body = await readBody(req);
      const patch = {};
      for (const k of ['nickname', 'sound', 'sol', 'evm', 'rank']) if (k in body) patch[k] = body[k];
      if ('sol' in patch || 'evm' in patch) patch.status = 'manual';
      const before = store.wallets.find((w) => w.id === m[1]);
      const w = store.updateWallet(m[1], patch);
      if (before && (before.sol !== w.sol || before.evm !== w.evm)) walletsChanged();
      else broadcast('wallets', store.wallets);
      return send(res, 200, w);
    }
    if (m && req.method === 'DELETE') {
      store.removeWallet(m[1]);
      walletsChanged();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/resolve' && req.method === 'POST') {
      const body = await readBody(req);
      runResolver(!!body.all);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      const file = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p).replace(/^([/\\])+/, ''));
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

// Only reachable from this computer, never from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Wallet Tracker is running.');
  console.log(`  Open this in your browser:  http://localhost:${PORT}`);
  console.log('  Keep this window open. Press Ctrl+C to stop.');
  console.log('');
  if (!hadEnv) console.log('  (No .env file found yet: copy .env.example to .env and add your keys. See README.)\n');
  const solCount = solAddresses().length;
  const evmCount = evmAddresses().length;
  const missing = store.wallets.filter((w) => !w.sol && !w.evm).length;
  log(`${store.wallets.length} traders loaded: ${solCount} Solana wallet(s), ${evmCount} EVM wallet(s), ${missing} without an address yet.`);
  prices.startNativePriceLoop();
  startWatchers();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Is the tracker already running in another window?`);
    console.error(`If so, just open http://localhost:${PORT}. Otherwise set PORT=3001 in .env.\n`);
    process.exit(1);
  }
  throw e;
});
