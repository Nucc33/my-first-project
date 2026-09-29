// Dashboard logic: live feed, sound alerts, wallet editing.
(() => {
  const $ = (s) => document.querySelector(s);
  const state = {
    feed: [],
    wallets: [],
    settings: { minBuyUsd: 100, soundOn: true, soundOnSells: false, desktopNotifications: false },
    status: {},
    resolverReady: false,
    view: { side: 'buy', chain: 'all', q: '', hideSmall: false },
    walletView: { q: '', onlyMissing: false },
    editing: null,
    unseen: 0,
  };
  const fresh = new Set();

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
  const CHAIN = { solana: 'SOL', base: 'BASE', bnb: 'BNB' };

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '?';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
    if (n >= 10) return `$${n.toFixed(0)}`;
    return `$${n.toFixed(2)}`;
  }
  function compact(n) {
    if (!n) return '';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${Math.round(n)}`;
  }
  function nat(n, sym) {
    if (!n) return '';
    const d = n >= 100 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 3 : 5;
    return `${n.toFixed(d)} ${sym}`;
  }
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  function clock(ms) {
    const d = new Date(ms);
    const today = new Date().toDateString() === d.toDateString();
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return today ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
  }
  const walletById = (id) => state.wallets.find((w) => w.id === id);

  async function api(path, method = 'GET', body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // ---------- sound ----------
  let audio = null;
  function audioReady() {
    return audio && audio.state === 'running';
  }
  function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== 'running') audio.resume();
    } catch {}
    setTimeout(renderUnlock, 50);
  }
  function tone(freq, start, dur, vol = 0.18, type = 'sine') {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audio.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, audio.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + start);
    o.stop(audio.currentTime + start + dur + 0.05);
  }
  // Top 1 / Top 3 traders get a longer, higher chime so you know it's important.
  function play(kind, rank) {
    if (!audioReady()) return;
    if (kind === 'sell') {
      tone(440, 0, 0.25, 0.15, 'triangle');
      tone(330, 0.18, 0.35, 0.15, 'triangle');
      return;
    }
    if (rank === 'Top 1' || rank === 'Top 3') {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.1, 0.3, 0.2));
    } else {
      tone(880, 0, 0.18);
      tone(1320, 0.12, 0.3);
    }
  }

  function shouldAlert(t) {
    if (t.history || !state.settings.soundOn) return false;
    const w = walletById(t.walletId);
    if (!w || !w.sound) return false;
    if (t.side === 'sell') return state.settings.soundOnSells;
    return t.usd === null || t.usd === undefined || t.usd >= state.settings.minBuyUsd;
  }

  function notify(t) {
    if (!state.settings.desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const tok = t.token.symbol ? `$${t.token.symbol}` : short(t.token.address);
    try {
      const n = new Notification(`${t.nickname} ${t.side === 'buy' ? 'bought' : 'sold'} ${tok}`, {
        body: `${money(t.usd)} · ${nat(t.native, t.nativeSymbol)} · ${CHAIN[t.chain]}`,
        tag: t.id,
      });
      n.onclick = () => { window.focus(); window.open(t.chartUrl, '_blank'); };
    } catch {}
  }

  // ---------- rendering: top bar ----------
  function renderChains() {
    const html = ['solana', 'base', 'bnb'].map((c) => {
      const s = state.status[c] || { state: 'off' };
      const label = { live: 'live', connecting: 'connecting', reconnecting: 'reconnecting', error: 'error', idle: 'no wallets', off: 'off' }[s.state] || s.state;
      return `<span class="chain-st" title="${esc(s.detail || '')}"><span class="dot ${esc(s.state)}"></span>${CHAIN[c]} <span>${esc(label)}</span></span>`;
    });
    $('#chains').innerHTML = html.join('');
  }
  function renderSoundBtn() {
    const b = $('#sound-btn');
    b.className = `sound-btn ${state.settings.soundOn ? 'on' : 'off'}`;
    b.textContent = state.settings.soundOn ? '🔔 Sound on' : '🔕 Sound off';
  }
  function renderUnlock() {
    $('#unlock').hidden = !state.settings.soundOn || audioReady();
  }

  // ---------- rendering: feed ----------
  function visible(t) {
    const v = state.view;
    if (v.side !== 'all' && t.side !== v.side) return false;
    if (v.chain !== 'all' && t.chain !== v.chain) return false;
    if (v.hideSmall && t.side === 'buy' && t.usd !== null && t.usd < state.settings.minBuyUsd) return false;
    if (v.q) {
      const hay = `${t.nickname} ${t.token.name || ''} ${t.token.symbol || ''} ${t.token.address}`.toLowerCase();
      if (!hay.includes(v.q)) return false;
    }
    return true;
  }

  function rowHtml(t) {
    const w = walletById(t.walletId);
    const name = w ? w.nickname : t.nickname;
    const rank = w ? w.rank : t.rank;
    const small = t.side === 'buy' && t.usd !== null && t.usd < state.settings.minBuyUsd;
    const tokName = t.token.name || 'Unknown token';
    const sym = t.token.symbol ? `$${t.token.symbol}` : short(t.token.address);
    const amountLabel = t.side === 'buy' ? 'spent' : 'got';
    const mc = t.token.marketCap ? `MC ${compact(t.token.marketCap)} · ` : '';
    return `
      <div class="row ${t.side} ${small ? 'small' : ''} ${fresh.has(t.id) ? 'fresh' : ''}" data-id="${esc(t.id)}">
        <div class="time"><div class="ago" data-time="${t.time}">${ago(t.time)}</div><div class="clock">${esc(clock(t.time))}</div></div>
        <div class="trader">
          <span class="side ${t.side}">${t.side.toUpperCase()}</span>
          <span class="name" title="${esc(t.wallet)}">${esc(name)}</span>
          ${rank ? `<span class="badge rank ${rank === 'Top 1' ? 'top1' : ''}">${esc(rank)}</span>` : ''}
          ${w && w.sound ? '<span class="bell" title="Sound on for this trader">●</span>' : ''}
        </div>
        <div class="token">
          <div class="tname">${esc(tokName)} <span class="tsym">${esc(sym)}</span></div>
          <div class="sub">${esc(mc)}${t.tokenAmount ? esc(Number(t.tokenAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })) + ' tokens' : ''}</div>
        </div>
        <div class="amount num">
          <div class="usd" title="${amountLabel}${t.approx ? ' (estimated)' : ''}">${t.approx ? '≈' : ''}${money(t.usd)}</div>
          <div class="nat">${esc(nat(t.native, t.nativeSymbol))}${t.paidWithStable ? ' (paid in USD coin)' : ''}</div>
        </div>
        <div class="chain-cell"><span class="chain-tag ${t.chain}">${CHAIN[t.chain]}</span></div>
        <div class="links">
          <a href="${esc(t.chartUrl)}" target="_blank" rel="noopener">Chart</a>
          <a href="${esc(t.txUrl)}" target="_blank" rel="noopener">Tx</a>
        </div>
      </div>`;
  }

  function renderFeed() {
    const list = state.feed.filter(visible).slice(0, 300);
    $('#feed').innerHTML = list.map(rowHtml).join('');
    const empty = $('#empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      const noKey = Object.values(state.status).some((s) => s && s.state === 'off');
      const noAddr = !state.wallets.some((w) => w.sol || w.evm);
      empty.innerHTML = noAddr
        ? 'None of your traders has a wallet address yet.<br>Go to <b>Wallets</b> and click <b>Look up wallets from Fomo</b>, or paste addresses in by hand.'
        : state.feed.length
          ? 'Nothing matches these filters.'
          : `Waiting for trades…${noKey ? '<br>Some chains are off: check your API keys in the .env file.' : ''}`;
    }
  }

  function tickTimes() {
    document.querySelectorAll('.ago[data-time]').forEach((el) => {
      el.textContent = ago(Number(el.dataset.time));
    });
  }

  // ---------- rendering: wallets page ----------
  function renderResolve() {
    const missing = state.wallets.filter((w) => w.fomo && !w.sol && !w.evm).length;
    const r = state.status.resolver || {};
    const box = $('#resolve-box');
    const ready = state.resolverReady;
    box.innerHTML = `
      <div>
        <b>${missing}</b> of ${state.wallets.length} traders have no wallet address yet.
        ${ready ? '' : '<br><span class="msg err">To look them up automatically, add FOMOSCAN_API_KEY to your .env file and restart (see README step 3).</span>'}
      </div>
      <button class="primary" id="resolve-btn" ${!ready || r.running || !missing ? 'disabled' : ''}>Look up wallets from Fomo</button>
      <button id="resolve-all-btn" ${!ready || r.running ? 'disabled' : ''} title="Look everyone up again, even ones that already have an address">Re-check all</button>
      <span class="msg">${esc(r.message || '')}</span>`;
    $('#resolve-btn').onclick = () => api('/api/resolve', 'POST', { all: false }).catch((e) => alert(e.message));
    $('#resolve-all-btn').onclick = () => {
      if (confirm('Look up every trader again? This replaces addresses found earlier (not ones you typed in).')) api('/api/resolve', 'POST', { all: true });
    };
  }

  function statusLabel(w) {
    if (w.status === 'resolved') return ['resolved', 'Found'];
    if (w.status === 'manual') return ['manual', 'Added by you'];
    if (w.status === 'not found') return ['notfound', 'NOT FOUND'];
    if (w.status === 'lookup failed') return ['failed', 'Lookup error'];
    return ['unresolved', w.sol || w.evm ? 'Set' : 'Not looked up'];
  }

  function renderWallets() {
    $('#wallet-count').textContent = state.wallets.length;
    const q = state.walletView.q;
    const list = state.wallets
      .filter((w) => !state.walletView.onlyMissing || (!w.sol && !w.evm))
      .filter((w) => !q || `${w.nickname} ${w.fomo || ''} ${w.sol || ''} ${w.evm || ''}`.toLowerCase().includes(q));
    const rows = list.map((w) => {
      const [cls, label] = statusLabel(w);
      return `
        <div class="wrow" data-id="${w.id}">
          <div class="trader"><span class="name">${esc(w.nickname)}</span>${w.rank ? `<span class="badge rank ${w.rank === 'Top 1' ? 'top1' : ''}">${esc(w.rank)}</span>` : ''}</div>
          <div class="addr ${w.sol ? '' : 'none'}" title="${esc(w.sol || '')}">${w.sol ? esc(w.sol) : 'no Solana wallet'}</div>
          <div class="addr ${w.evm ? '' : 'none'}" title="${esc(w.evm || '')}">${w.evm ? esc(w.evm) : 'no EVM wallet'}</div>
          <div class="st ${cls}" title="${esc(w.note || '')}">${label}</div>
          <div><button class="toggle ${w.sound ? 'on' : ''}" data-act="sound" title="Sound on buys"></button></div>
          <div class="wactions"><button data-act="edit">Edit</button><button data-act="del" class="danger">Remove</button></div>
        </div>`;
    });
    $('#wallet-table').innerHTML = `
      <div class="wrow head"><div>Trader</div><div>Solana</div><div>Base / BNB</div><div>Status</div><div>Sound</div><div></div></div>
      ${rows.join('') || '<div class="empty">No traders match.</div>'}`;
    renderResolve();
  }

  function renderAll() {
    renderChains();
    renderSoundBtn();
    renderUnlock();
    renderFeed();
    renderWallets();
    $('#min-buy').value = state.settings.minBuyUsd;
    $('#sound-sells').checked = state.settings.soundOnSells;
    $('#desktop-notif').checked = state.settings.desktopNotifications;
  }

  // ---------- live updates ----------
  function onTrade(t) {
    if (state.feed.some((x) => x.id === t.id)) return;
    state.feed.unshift(t);
    state.feed.sort((a, b) => b.time - a.time);
    if (state.feed.length > 1000) state.feed.length = 1000;
    if (!t.history) {
      fresh.add(t.id);
      setTimeout(() => fresh.delete(t.id), 2500);
      if (shouldAlert(t)) {
        play(t.side, t.rank);
        notify(t);
      }
      if (document.hidden && t.side === 'buy') {
        state.unseen++;
        document.title = `(${state.unseen}) Wallet Tracker`;
      }
    }
    renderFeed();
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('trade', (e) => onTrade(JSON.parse(e.data)));
    es.addEventListener('update', (e) => {
      const t = JSON.parse(e.data);
      const i = state.feed.findIndex((x) => x.id === t.id);
      if (i >= 0) { state.feed[i] = t; renderFeed(); }
    });
    es.addEventListener('status', (e) => {
      state.status = JSON.parse(e.data);
      renderChains();
      renderResolve();
    });
    es.addEventListener('wallets', (e) => {
      state.wallets = JSON.parse(e.data);
      renderWallets();
      renderFeed();
    });
    es.addEventListener('settings', (e) => {
      state.settings = JSON.parse(e.data);
      renderSoundBtn();
      renderUnlock();
      renderFeed();
    });
    es.onerror = () => {
      state.status = { ...state.status, solana: { state: 'error', detail: 'Lost connection to the tracker. Is it still running?' } };
      renderChains();
    };
    es.onopen = () => load(); // re-sync after the tracker restarts
  }

  async function load() {
    const s = await api('/api/state');
    state.feed = s.feed;
    state.wallets = s.wallets;
    state.settings = s.settings;
    state.status = s.status;
    state.resolverReady = s.resolverReady;
    renderAll();
  }

  async function saveSettings(patch) {
    state.settings = await api('/api/settings', 'POST', patch);
    renderSoundBtn();
    renderUnlock();
    renderFeed();
  }

  // ---------- controls ----------
  document.querySelectorAll('.page-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.page-btn').forEach((x) => x.classList.toggle('active', x === b));
      $('#page-feed').hidden = b.dataset.page !== 'feed';
      $('#page-wallets').hidden = b.dataset.page !== 'wallets';
    };
  });
  function seg(id, key, attr) {
    document.querySelectorAll(`#${id} button`).forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('active', x === b));
        state.view[key] = b.dataset[attr];
        renderFeed();
      };
    });
  }
  seg('side-seg', 'side', 'side');
  seg('chain-seg', 'chain', 'chain');
  $('#search').oninput = (e) => { state.view.q = e.target.value.trim().toLowerCase(); renderFeed(); };
  $('#hide-small').onchange = (e) => { state.view.hideSmall = e.target.checked; renderFeed(); };
  let minTimer;
  $('#min-buy').oninput = (e) => {
    clearTimeout(minTimer);
    minTimer = setTimeout(() => saveSettings({ minBuyUsd: Number(e.target.value) || 0 }), 400);
  };
  $('#sound-btn').onclick = () => { unlockAudio(); saveSettings({ soundOn: !state.settings.soundOn }); };
  $('#sound-sells').onchange = (e) => saveSettings({ soundOnSells: e.target.checked });
  $('#desktop-notif').onchange = async (e) => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        e.target.checked = false;
        alert('Your browser blocked notifications. You can allow them in the browser settings for this page.');
        return;
      }
    }
    saveSettings({ desktopNotifications: e.target.checked });
  };
  $('#test-sound').onclick = () => { unlockAudio(); setTimeout(() => play('buy', 'Top 1'), 150); };
  document.addEventListener('pointerdown', unlockAudio, { once: false });
  document.addEventListener('keydown', unlockAudio);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { state.unseen = 0; document.title = 'Wallet Tracker'; }
  });

  $('#wallet-search').oninput = (e) => { state.walletView.q = e.target.value.trim().toLowerCase(); renderWallets(); };
  $('#only-missing').onchange = (e) => { state.walletView.onlyMissing = e.target.checked; renderWallets(); };

  // Wallet table buttons
  $('#wallet-table').onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.wrow').dataset.id;
    const w = walletById(id);
    if (!w) return;
    try {
      if (btn.dataset.act === 'sound') {
        await api(`/api/wallets/${id}`, 'PATCH', { sound: !w.sound });
        w.sound = !w.sound;
        renderWallets();
        renderFeed();
      } else if (btn.dataset.act === 'del') {
        if (!confirm(`Remove ${w.nickname}? Their past trades stay in the feed.`)) return;
        await api(`/api/wallets/${id}`, 'DELETE');
      } else if (btn.dataset.act === 'edit') {
        startEdit(w);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const form = $('#wallet-form');
  function startEdit(w) {
    state.editing = w.id;
    form.nickname.value = w.nickname;
    form.sol.value = w.sol || '';
    form.evm.value = w.evm || '';
    form.sound.checked = w.sound;
    $('#form-title').textContent = `Edit ${w.nickname}`;
    $('#form-submit').textContent = 'Save changes';
    $('#form-cancel').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.sol.focus();
  }
  function resetForm() {
    state.editing = null;
    form.reset();
    form.sound.checked = true;
    $('#form-title').textContent = 'Add a trader';
    $('#form-submit').textContent = 'Add trader';
    $('#form-cancel').hidden = true;
  }
  $('#form-cancel').onclick = resetForm;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#form-msg');
    const body = {
      nickname: form.nickname.value.trim(),
      sol: form.sol.value.trim() || null,
      evm: form.evm.value.trim() || null,
      sound: form.sound.checked,
    };
    try {
      if (state.editing) await api(`/api/wallets/${state.editing}`, 'PATCH', body);
      else await api('/api/wallets', 'POST', body);
      msg.className = 'msg ok';
      msg.textContent = state.editing ? 'Saved.' : `Added ${body.nickname}.`;
      resetForm();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  };

  $('#unlock').onclick = unlockAudio;
  setInterval(tickTimes, 5000);
  load().then(connectEvents).catch(() => {
    $('#empty').hidden = false;
    $('#empty').textContent = 'Cannot reach the tracker. Make sure it is running (npm start).';
  });
})();
