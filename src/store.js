// Keeps the wallet list, settings and recent trades on disk so nothing is lost on restart.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isSolanaAddress, isEvmAddress } = require('./util');

const ROOT = path.join(__dirname, '..');
const WALLETS_FILE = process.env.WALLETS_FILE || path.join(ROOT, 'wallets.json');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const MAX_FEED = 1000;

const DEFAULT_SETTINGS = {
  minBuyUsd: 100, // buys smaller than this never make a sound
  soundOn: true,
  soundOnSells: false,
  desktopNotifications: false,
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function cleanWallet(w) {
  const sol = typeof w.sol === 'string' && w.sol.trim() ? w.sol.trim() : null;
  const evm = typeof w.evm === 'string' && w.evm.trim() ? w.evm.trim().toLowerCase() : null;
  return {
    id: w.id || crypto.randomBytes(4).toString('hex'),
    nickname: String(w.nickname || w.fomo || 'Unnamed').trim().slice(0, 40),
    fomo: w.fomo ? String(w.fomo).trim() : null,
    rank: w.rank || '',
    sound: !!w.sound,
    sol: sol && isSolanaAddress(sol) ? sol : null,
    evm: evm && isEvmAddress(evm) ? evm : null,
    status: w.status || (sol || evm ? 'manual' : 'unresolved'),
    note: w.note || undefined,
  };
}

class Store {
  constructor() {
    const raw = readJson(WALLETS_FILE, []);
    this.wallets = (Array.isArray(raw) ? raw : []).map(cleanWallet);
    this.settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
    this.feed = readJson(FEED_FILE, []);
    if (!Array.isArray(this.feed)) this.feed = [];
    this.saveWallets();
    this._feedTimer = null;
  }

  saveWallets() {
    writeJson(WALLETS_FILE, this.wallets.map((w) => ({ ...w, note: w.note || undefined })));
  }

  saveSettings() {
    writeJson(SETTINGS_FILE, this.settings);
  }

  // Feed writes are batched so a burst of trades doesn't hammer the disk.
  saveFeedSoon() {
    if (this._feedTimer) return;
    this._feedTimer = setTimeout(() => {
      this._feedTimer = null;
      writeJson(FEED_FILE, this.feed);
    }, 2000);
  }

  addWallet(input) {
    const w = cleanWallet({ ...input, id: undefined, status: 'manual' });
    if (!w.sol && !w.evm) throw new Error('Enter at least one valid Solana or EVM (0x...) address.');
    this.wallets.push(w);
    this.saveWallets();
    return w;
  }

  updateWallet(id, patch) {
    const i = this.wallets.findIndex((w) => w.id === id);
    if (i < 0) throw new Error('Wallet not found');
    const merged = cleanWallet({ ...this.wallets[i], ...patch, id });
    if (('sol' in patch && patch.sol && !merged.sol) || ('evm' in patch && patch.evm && !merged.evm)) {
      throw new Error('That address does not look valid.');
    }
    this.wallets[i] = merged;
    this.saveWallets();
    return merged;
  }

  removeWallet(id) {
    this.wallets = this.wallets.filter((w) => w.id !== id);
    this.saveWallets();
  }

  updateSettings(patch) {
    const s = this.settings;
    if (patch.minBuyUsd !== undefined) s.minBuyUsd = Math.max(0, Number(patch.minBuyUsd) || 0);
    for (const k of ['soundOn', 'soundOnSells', 'desktopNotifications']) {
      if (patch[k] !== undefined) s[k] = !!patch[k];
    }
    this.saveSettings();
    return s;
  }

  hasTrade(id) {
    return this.feed.some((t) => t.id === id);
  }

  addTrade(trade) {
    if (this.hasTrade(trade.id)) return false;
    this.feed.push(trade);
    this.feed.sort((a, b) => b.time - a.time);
    if (this.feed.length > MAX_FEED) this.feed.length = MAX_FEED;
    this.saveFeedSoon();
    return true;
  }

  patchTrade(id, patch) {
    const t = this.feed.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    this.saveFeedSoon();
    return t;
  }

  // Look up who owns an address (addresses are case-insensitive on EVM).
  walletsFor(chain, address) {
    if (chain === 'solana') return this.wallets.filter((w) => w.sol === address);
    const a = address.toLowerCase();
    return this.wallets.filter((w) => w.evm === a);
  }
}

module.exports = { Store, cleanWallet, DEFAULT_SETTINGS };
