'use strict';
// ---------------------------------------------------------------------------
// Procedural audio: every sound is synthesized with the Web Audio API.
// Sound effects are short oscillator/noise envelopes; music is a tiny
// look-ahead step sequencer whose arrangement follows the game's intensity.
// ---------------------------------------------------------------------------

const Sound = (() => {
  let ctx = null, master, sfxBus, musicBus, musicFilter, noiseBuf;
  let muted = Store.get('muted', false);
  let musicOn = Store.get('music', true);
  const lastPlayed = {};
  let voices = 0;
  const MAX_VOICES = 56;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.75;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.3 : 0;
    musicBus.connect(musicFilter); musicFilter.connect(master);

    // 2.8s of noise: longest noise sfx (~2.2s) + random start offset (<=0.5s) must fit.
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.8), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    Music.start();
  }

  function throttle(name, ms) {
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < ms) return false;
    lastPlayed[name] = now;
    return true;
  }

  function canPlay(bus) {
    return ctx && !muted && voices < MAX_VOICES && (bus !== musicBus || musicOn);
  }

  function track(src) { voices++; src.onended = () => { voices--; }; }

  function envelope(g, t, vol, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // o: { type, f, f2, dur, vol, attack, delay, detune, lp, lp2, q, bus, at }
  function tone(o) {
    const bus = o.bus || sfxBus;
    if (!canPlay(bus)) return;
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    envelope(g, t, o.vol, o.attack || 0.004, o.dur);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + o.dur);
      node.connect(f); node = f;
    }
    node.connect(g); g.connect(bus);
    track(osc);
    osc.start(t); osc.stop(t + o.dur + 0.03);
  }

  // o: { dur, vol, filter: 'lowpass'|'highpass'|'bandpass', f, f2, q, attack, delay, bus, at }
  function noise(o) {
    const bus = o.bus || sfxBus;
    if (!canPlay(bus)) return;
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ctx.createGain();
    envelope(g, t, o.vol, o.attack || 0.003, o.dur);
    src.connect(f); f.connect(g); g.connect(bus);
    track(src);
    const offset = Math.random() * 0.5;
    src.start(t, offset, o.dur + 0.05);
  }

  const midi = m => 440 * Math.pow(2, (m - 69) / 12);

  // --- Sound effects ------------------------------------------------------
  const sfx = {
    shoot() {
      if (!throttle('shoot', 45)) return;
      tone({ type: 'square', f: rand(820, 900), f2: 180, dur: 0.07, vol: 0.035, lp: 4000 });
      noise({ filter: 'highpass', f: 5000, dur: 0.025, vol: 0.03 });
    },
    hit() {
      if (!throttle('hit', 28)) return;
      noise({ filter: 'bandpass', f: rand(2500, 3500), q: 1.5, dur: 0.045, vol: 0.12 });
      tone({ type: 'square', f: rand(260, 320), f2: 120, dur: 0.05, vol: 0.03 });
    },
    crit() {
      if (!throttle('crit', 50)) return;
      tone({ type: 'square', f: 1500, f2: 700, dur: 0.07, vol: 0.05, lp: 5000 });
    },
    kill(size = 1) {
      if (!throttle('kill', 32)) return;
      noise({ filter: 'lowpass', f: 2600, f2: 180, dur: 0.22 + 0.15 * size, vol: 0.22 + 0.08 * size });
      tone({ type: 'sine', f: 170 * rand(0.9, 1.1), f2: 38, dur: 0.18 + 0.1 * size, vol: 0.28 });
    },
    explode() {
      if (!throttle('explode', 60)) return;
      noise({ filter: 'lowpass', f: 1800, f2: 150, dur: 0.3, vol: 0.2 });
      tone({ type: 'sine', f: 120, f2: 35, dur: 0.25, vol: 0.22 });
    },
    bigExplode() {
      noise({ filter: 'lowpass', f: 3500, f2: 60, dur: 1.4, vol: 0.55 });
      tone({ type: 'sine', f: 110, f2: 24, dur: 1.1, vol: 0.55 });
      tone({ type: 'sawtooth', f: 220, f2: 30, dur: 0.9, vol: 0.12, lp: 1200, lp2: 100 });
    },
    hurt() {
      tone({ type: 'sawtooth', f: 240, f2: 50, dur: 0.32, vol: 0.22, lp: 2000, lp2: 200 });
      noise({ filter: 'lowpass', f: 1500, f2: 200, dur: 0.25, vol: 0.25 });
    },
    dash() {
      noise({ filter: 'bandpass', f: 300, f2: 2600, q: 2.5, dur: 0.2, vol: 0.28 });
      tone({ type: 'sine', f: 180, f2: 520, dur: 0.14, vol: 0.06 });
    },
    pickup(step) {
      if (!throttle('pickup', 22)) return;
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const m = 76 + scale[step % scale.length];
      tone({ type: 'sine', f: midi(m), dur: 0.07, vol: 0.05 });
      tone({ type: 'triangle', f: midi(m + 12), dur: 0.05, vol: 0.02 });
    },
    levelUp() {
      [0, 4, 7, 12, 16].forEach((n, i) => {
        tone({ type: 'square', f: midi(72 + n), dur: 0.16, vol: 0.06, delay: i * 0.055, lp: 3500 });
        tone({ type: 'triangle', f: midi(84 + n), dur: 0.2, vol: 0.04, delay: i * 0.055 });
      });
      noise({ filter: 'highpass', f: 6000, dur: 0.5, vol: 0.06, attack: 0.1 });
    },
    nova() {
      tone({ type: 'sine', f: 90, f2: 400, dur: 0.35, vol: 0.2 });
      noise({ filter: 'bandpass', f: 800, f2: 5000, q: 1.2, dur: 0.35, vol: 0.2 });
    },
    hover() {
      if (!throttle('hover', 40)) return;
      tone({ type: 'sine', f: 1100, dur: 0.035, vol: 0.04 });
    },
    select() {
      tone({ type: 'triangle', f: 520, f2: 1560, dur: 0.18, vol: 0.12 });
      tone({ type: 'square', f: midi(79), dur: 0.12, vol: 0.04, delay: 0.06, lp: 3000 });
      tone({ type: 'square', f: midi(86), dur: 0.2, vol: 0.04, delay: 0.12, lp: 3000 });
    },
    cardAppear(i) {
      tone({ type: 'triangle', f: midi(67 + i * 5), dur: 0.09, vol: 0.06 });
    },
    waveStart() {
      tone({ type: 'sawtooth', f: 110, f2: 220, dur: 0.6, vol: 0.1, lp: 400, lp2: 3000, attack: 0.05 });
      tone({ type: 'sawtooth', f: 165, f2: 330, dur: 0.6, vol: 0.07, lp: 400, lp2: 3000, attack: 0.05, detune: 8 });
    },
    waveClear() {
      [0, 3, 7, 10, 15].forEach((n, i) =>
        tone({ type: 'triangle', f: midi(69 + n), dur: 0.25, vol: 0.09, delay: i * 0.07 }));
    },
    bossSpawn() {
      tone({ type: 'sawtooth', f: 55, dur: 2.4, vol: 0.28, lp: 120, lp2: 1400, attack: 0.6 });
      tone({ type: 'sawtooth', f: 55, dur: 2.4, vol: 0.2, lp: 120, lp2: 1400, attack: 0.6, detune: 25 });
      tone({ type: 'sine', f: 30, dur: 2.2, vol: 0.4, attack: 0.3 });
      noise({ filter: 'bandpass', f: 200, f2: 3000, q: 3, dur: 2.2, vol: 0.18, attack: 1.2 });
    },
    enemyShoot() {
      if (!throttle('eshoot', 70)) return;
      tone({ type: 'triangle', f: 620, f2: 240, dur: 0.1, vol: 0.05 });
    },
    charge() {
      if (!throttle('charge', 120)) return;
      tone({ type: 'sine', f: 220, f2: 900, dur: 0.5, vol: 0.05 });
    },
    zap() {
      if (!throttle('zap', 50)) return;
      noise({ filter: 'bandpass', f: 4000, q: 2, dur: 0.09, vol: 0.12 });
      tone({ type: 'square', f: 1900, f2: 500, dur: 0.07, vol: 0.03 });
    },
    block() {
      if (!throttle('block', 40)) return;
      tone({ type: 'sine', f: 1300, f2: 2100, dur: 0.06, vol: 0.05 });
    },
    comboLost() {
      tone({ type: 'square', f: 440, f2: 110, dur: 0.3, vol: 0.05, lp: 2000 });
    },
    heartbeat() {
      tone({ type: 'sine', f: 70, f2: 40, dur: 0.13, vol: 0.3 });
      tone({ type: 'sine', f: 65, f2: 38, dur: 0.13, vol: 0.22, delay: 0.16 });
    },
    gameOver() {
      tone({ type: 'sawtooth', f: 440, f2: 40, dur: 1.8, vol: 0.18, lp: 3000, lp2: 80 });
      tone({ type: 'sawtooth', f: 443, f2: 41, dur: 1.8, vol: 0.12, lp: 3000, lp2: 80, detune: 20 });
    },
    start() {
      [0, 7, 12, 19].forEach((n, i) =>
        tone({ type: 'square', f: midi(57 + n), dur: 0.3, vol: 0.06, delay: i * 0.06, lp: 2500 }));
      noise({ filter: 'bandpass', f: 400, f2: 6000, q: 1, dur: 0.5, vol: 0.12 });
    },
  };

  // --- Music ---------------------------------------------------------------
  const Music = (() => {
    // A minor: Am – F – C – G, one chord per bar.
    const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const roots = [45, 41, 48, 43];
    let step = 0, nextTime = 0, timer = null;
    let intensity = 0;

    const bpm = () => [96, 116, 124, 132][intensity];
    const stepDur = () => 60 / bpm() / 4;

    function playStep(s, t) {
      const bar = Math.floor(s / 16) % 4, i = s % 16;
      const ch = chords[bar], root = roots[bar], sd = stepDur();
      const M = musicBus;
      if (intensity === 0) {
        if (i === 0) ch.forEach(n => tone({ bus: M, at: t, type: 'triangle', f: midi(n), dur: sd * 16, vol: 0.09, attack: 0.5 }));
        if (i % 8 === 0) tone({ bus: M, at: t, type: 'sine', f: midi(root), dur: sd * 7, vol: 0.4, attack: 0.05 });
        if (i % 4 === 2) noise({ bus: M, at: t, filter: 'highpass', f: 8000, dur: 0.03, vol: 0.05 });
        if (i % 3 === 0) tone({ bus: M, at: t, type: 'sine', f: midi(ch[(s / 3 | 0) % 3] + 24), dur: sd * 2, vol: 0.03 });
        return;
      }
      // Kick
      if (i % 4 === 0) tone({ bus: M, at: t, type: 'sine', f: 150, f2: 42, dur: 0.22, vol: 0.9 });
      // Hats
      if (i % 2 === 1 || (intensity >= 3)) noise({ bus: M, at: t, filter: 'highpass', f: 7500, dur: i % 4 === 2 ? 0.06 : 0.025, vol: 0.08 });
      // Snare
      if (intensity >= 2 && (i === 4 || i === 12)) {
        noise({ bus: M, at: t, filter: 'bandpass', f: 1800, q: 0.7, dur: 0.16, vol: 0.35 });
        tone({ bus: M, at: t, type: 'triangle', f: 210, f2: 120, dur: 0.1, vol: 0.2 });
      }
      // Bass: offbeat eighths, sixteenths at high intensity
      const bassHit = intensity >= 3 ? i % 2 === 0 || i % 4 === 3 : (i % 4 === 2 || i === 0);
      if (bassHit) {
        const n = root + (i === 14 && intensity >= 2 ? 7 : 0);
        tone({ bus: M, at: t, type: 'sawtooth', f: midi(n), dur: sd * 1.6, vol: 0.28, lp: intensity >= 3 ? 1100 : 700, lp2: 200, q: 4 });
      }
      // Arp
      if (intensity >= 2) {
        const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
        const n = ch[pattern[i % 8]] + 12 + (i >= 8 && intensity >= 3 ? 12 : 0);
        tone({ bus: M, at: t, type: 'square', f: midi(n), dur: sd * 0.9, vol: 0.05, lp: 2600 });
      }
      // Pad
      if (i === 0) ch.forEach(n => tone({ bus: M, at: t, type: 'triangle', f: midi(n), dur: sd * 16, vol: 0.05, attack: 0.3 }));
    }

    function schedule() {
      if (!ctx) return;
      const now = ctx.currentTime;
      // Tab was hidden / throttled: jump ahead instead of spraying catch-up notes.
      if (nextTime < now - 0.05) nextTime = now + 0.05;
      while (nextTime < now + 0.12) {
        if (musicOn && !muted) playStep(step, nextTime);
        nextTime += stepDur();
        step++;
      }
    }

    return {
      start() {
        if (timer) return;
        nextTime = ctx.currentTime + 0.1;
        timer = setInterval(schedule, 25);
      },
      setIntensity(level) {
        if (level === intensity) return;
        intensity = level;
        step = Math.ceil(step / 16) * 16; // change arrangement on a bar line
      },
    };
  })();

  function setMuffled(on) {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicFilter.frequency.cancelScheduledValues(t);
    musicFilter.frequency.setTargetAtTime(on ? 650 : 18000, t, 0.08);
  }

  return {
    init,
    sfx,
    get muted() { return muted; },
    get musicOn() { return musicOn; },
    toggleMute() {
      muted = !muted;
      Store.set('muted', muted);
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.75, ctx.currentTime, 0.02);
    },
    toggleMusic() {
      musicOn = !musicOn;
      Store.set('music', musicOn);
      if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? 0.3 : 0, ctx.currentTime, 0.05);
    },
    setIntensity(l) { if (ctx) Music.setIntensity(l); },
    setMuffled,
  };
})();
