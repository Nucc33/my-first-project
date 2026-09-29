// Looks up Fomo usernames and fills in their Solana and EVM wallet addresses.
//
// Fomo itself has no public API, so this uses third-party lookup services:
//   1. FomoLens      (https://fomolens.app)   -> set FOMOLENS_API_KEY in .env
//   2. getfomoapi.fun (Open-Fomo-API)         -> set FOMOAPI_KEY in .env (optional backup)
// Only the Fomo username is sent. Nothing else about you or your wallets.
//
// Run it with:  npm run resolve          (only the ones not found yet)
//               npm run resolve -- --all (look everyone up again)
const { fetchJson, isSolanaAddress, isEvmAddress, sleep, log } = require('./util');

// Collect every wallet-looking string in a response, remembering the field it came from.
function collect(node, path, out, hint) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const where = (path.join('.') + ' ' + (hint || '')).toLowerCase();
    if (isEvmAddress(node)) out.push({ type: 'evm', value: node.toLowerCase(), where });
    else if (isSolanaAddress(node)) out.push({ type: 'sol', value: node, where });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, [...path, String(i)], out, hint));
    return;
  }
  if (typeof node === 'object') {
    // e.g. { chain: "solana", address: "..." }
    const label = ['chain', 'type', 'network', 'blockchain', 'kind', 'walletFamily', 'family'].map((k) => node[k]).filter((v) => typeof v === 'string').join(' ');
    for (const [k, v] of Object.entries(node)) collect(v, [...path, k], out, label || hint);
  }
}

// Fields that are clearly NOT the trader's own wallet.
const IGNORE = /(token|mint|contract|pair|pool|referr|follow|holding|balance|swap|trade|tx|signature|hash|history|previous|old)/;

function extractWallets(json) {
  const found = [];
  collect(json, [], found, '');
  const own = found.filter((f) => !IGNORE.test(f.where));
  const pick = (type, pref) => {
    const list = own.filter((f) => f.type === type);
    const preferred = list.filter((f) => pref.test(f.where));
    const use = preferred.length ? preferred : list;
    const distinct = [...new Set(use.map((f) => f.value))];
    return { value: distinct[0] || null, extra: distinct.slice(1) };
  };
  const sol = pick('sol', /sol/);
  const evm = pick('evm', /(evm|eth|base|bsc|bnb|0x)/);
  return { sol: sol.value, evm: evm.value, extra: [...sol.extra, ...evm.extra] };
}

const PROVIDERS = [
  {
    name: 'FomoLens',
    env: 'FOMOLENS_API_KEY',
    url: (h) => `${process.env.FOMOLENS_API_URL || 'https://api.fomolens.app/api/v1'}/users/${encodeURIComponent(h)}/wallets`,
    headers: (k) => ({ Authorization: `Bearer ${k}`, Accept: 'application/json' }),
  },
  {
    name: 'getfomoapi.fun',
    env: 'FOMOAPI_KEY',
    url: (h) => `${process.env.FOMOAPI_URL || 'https://getfomoapi.fun/api'}/users/${encodeURIComponent(h)}`,
    headers: (k) => ({ 'X-API-Key': k, Accept: 'application/json' }),
  },
];

function configuredProviders() {
  return PROVIDERS.filter((p) => process.env[p.env] && process.env[p.env].trim());
}

async function lookup(handle) {
  const providers = configuredProviders();
  let lastErr = null;
  let notFound = false;
  for (const p of providers) {
    // Rate-limited (429) or briefly down (503): wait and try the same request again.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const json = await fetchJson(p.url(handle), { headers: p.headers(process.env[p.env].trim()) });
        const w = extractWallets(json);
        if (w.sol || w.evm) return { ...w, source: p.name };
        notFound = true;
      } catch (e) {
        const code = e.body && e.body.error;
        if (e.status === 429 || e.status === 503) {
          await sleep(e.status === 429 ? 15000 : 5000);
          continue;
        }
        if (e.status === 404) notFound = true;
        else if (e.status === 401) lastErr = new Error(`${p.name} rejected the API key (check ${p.env} in .env; it should start with fl_live_)`);
        else if (e.status === 402) lastErr = new Error(`${p.name}: out of credits (${code || 'insufficient_credits'}). Top up on their dashboard.`);
        else if (e.status === 403) lastErr = new Error(`${p.name}: account can't use the API yet (${code || 'forbidden'}). It needs a paid plan or an approved trial.`);
        else lastErr = new Error(`${p.name}: ${code || e.message}`);
      }
      break;
    }
  }
  if (notFound) return { sol: null, evm: null, notFound: true };
  throw lastErr || new Error('no lookup service configured');
}

/**
 * Resolve wallets in the store.
 * @param onProgress called with (doneCount, total, wallet)
 */
async function resolveAll(store, { all = false, onProgress } = {}) {
  if (!configuredProviders().length) {
    throw new Error('No lookup API key found. Add FOMOLENS_API_KEY to your .env file (see README, step 3).');
  }
  const todo = store.wallets.filter((w) => w.fomo && (all || (!w.sol && !w.evm)));
  const summary = { resolved: [], notFound: [], failed: [] };
  let i = 0;
  for (const w of todo) {
    i++;
    try {
      const r = await lookup(w.fomo);
      if (r.notFound) {
        store.updateWallet(w.id, { status: 'not found' });
        summary.notFound.push(w.nickname);
      } else {
        store.updateWallet(w.id, {
          sol: r.sol || w.sol,
          evm: r.evm || w.evm,
          status: 'resolved',
          note: r.extra.length ? `Other wallets seen: ${r.extra.join(', ')}` : undefined,
        });
        summary.resolved.push(w.nickname);
      }
    } catch (e) {
      store.updateWallet(w.id, { status: 'lookup failed' });
      summary.failed.push(`${w.nickname} (${e.message})`);
      if (/rejected the API key|no lookup service|out of credits|can't use the API/.test(e.message)) throw e;
    }
    if (onProgress) onProgress(i, todo.length, w);
    // FomoLens trial accounts allow 10 requests per minute, so go slowly by default.
    await sleep(Number(process.env.RESOLVE_DELAY_MS) || 6500);
  }
  return summary;
}

if (require.main === module) {
  require('./env').loadEnv();
  const { Store } = require('./store');
  const store = new Store();
  const all = process.argv.includes('--all');
  log(`Looking up Fomo wallets (${all ? 'everyone' : 'only missing ones'})...`);
  resolveAll(store, {
    all,
    onProgress: (i, n, w) => {
      const now = store.wallets.find((x) => x.id === w.id);
      const s = now.sol || now.evm ? `SOL ${now.sol || '-'}  EVM ${now.evm || '-'}` : now.status.toUpperCase();
      console.log(`  ${String(i).padStart(3)}/${n}  ${w.nickname.padEnd(20)} ${s}`);
    },
  })
    .then((s) => {
      console.log(`\nDone. Found: ${s.resolved.length}   Not found: ${s.notFound.length}   Errors: ${s.failed.length}`);
      if (s.notFound.length) console.log(`Not found (add these by hand in the dashboard): ${s.notFound.join(', ')}`);
      if (s.failed.length) console.log(`Errors:\n  ${s.failed.join('\n  ')}`);
    })
    .catch((e) => {
      console.error(`\n${e.message}`);
      process.exit(1);
    });
}

module.exports = { resolveAll, extractWallets, configuredProviders };
