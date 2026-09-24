'use strict';
// ---------------------------------------------------------------------------
// Core: state machine, fixed-timestep loop, collision passes, and the
// render pipeline (scene -> downsampled bloom -> vignette/flash -> screen).
// ---------------------------------------------------------------------------

const STEP = 1 / 60;
const MAX_R = 66; // largest enemy radius (boss spikes), for broadphase query padding

const Game = {
  state: 'title',

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.scene = document.createElement('canvas');
    this.sctx = this.scene.getContext('2d');
    this.blurs = [0, 1, 2].map(() => {
      const c = document.createElement('canvas');
      return { c, x: c.getContext('2d') };
    });
    this.vignette = document.createElement('canvas');
    this.redVignette = document.createElement('canvas');

    this.grid = new WarpGrid(ARENA_W, ARENA_H, 40);
    this.egrid = new SpatialGrid(ARENA_W, ARENA_H, 80);
    this.cam = { x: ARENA_W / 2, y: ARENA_H / 2, zoom: 1 };
    this.mouseWorld = { x: ARENA_W / 2, y: ARENA_H / 2 };
    this.highScore = Store.get('highscore', 0);
    this.bestWave = Store.get('bestwave', 0);
    this.realT = 0; this.t = 0; this.tick = 0;
    this.titleT = 0;
    this.tmpA = []; this.tmpB = [];
    this.ui = { hpLag: 1, scoreShown: 0, multPop: 0, cardHover: [0, 0, 0], goScore: 0 };
    this.resetWorld();

    Input.init(this.canvas);
    Input.onBlur = () => { if (this.state === 'playing') this.pause(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    window.addEventListener('resize', () => this.resize());
    // Audio may only start from a user gesture.
    const unlock = () => Sound.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.resize();

    let last = performance.now(), acc = 0;
    const frame = now => {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      if (Math.abs(dt - STEP) < 0.0006) dt = STEP; // absorb vsync jitter so 60Hz gets exactly 1 step
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        this.update(STEP);
        Input.endTick();
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  resetWorld() {
    this.player = new Player(ARENA_W / 2, ARENA_H / 2);
    this.director = new Director(this);
    this.enemies = []; this.bullets = []; this.ebullets = []; this.orbs = []; this.explosions = [];
    this.score = 0; this.combo = 0; this.comboT = 0; this.lastMult = 1;
    this.wave = 0;
    this.stats = { kills: 0, maxCombo: 0, time: 0, dmg: 0, bosses: 0 };
    this.hitstop = 0; this.lastHitStop = -1; this.slowmo = 0;
    this.waveClearing = false; this.vacuum = false; this.clearT = 0;
    this.purgeT = 0;
    this.banner = null;
    this.boss = null;
    this.choices = []; this.chosen = -1;
    this.bulletId = 0;
    this.pickupStreak = 0; this.lastPickup = -1;
    this.newHigh = false;
    FX.reset(); Shake.reset(); this.grid.reset();
    this.ui.hpLag = 1; this.ui.scoreShown = 0; this.ui.goScore = 0;
  },

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxPx = 2560 * 1440;
    if (W * H * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (W * H));
    this.W = W; this.H = H; this.dpr = dpr;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    for (const c of [this.canvas, this.scene]) { c.width = cw; c.height = ch; }
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    let bw = cw, bh = ch;
    for (const b of this.blurs) {
      bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
      b.c.width = bw; b.c.height = bh;
    }
    this.cam.zoom = clamp(Math.min(W / 1400, H / 850), 0.55, 1.25);

    const mkVig = (cv, inner, outer) => {
      cv.width = 256; cv.height = 256;
      const x = cv.getContext('2d');
      const gr = x.createRadialGradient(128, 128, 60, 128, 128, 182);
      gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    };
    mkVig(this.vignette, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.7)');
    mkVig(this.redVignette, 'rgba(255,0,40,0)', 'rgba(255,20,60,0.55)');
  },

  get mult() { return Math.min(20, 1 + Math.floor(this.combo / 10)); },

  // ---------------------------------------------------------------- states
  startRun() {
    Sound.init();
    Sound.sfx.start();
    this.resetWorld();
    this.state = 'playing';
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    Sound.setMuffled(false);
    // Practice / testing: index.html?wave=N starts at wave N with N-1 random upgrades.
    const startWave = parseInt(new URLSearchParams(location.search).get('wave'), 10);
    if (startWave > 1) {
      this.wave = Math.min(startWave, 99) - 1;
      for (let i = 0; i < this.wave; i++) applyUpgrade(rollUpgrades(this.player, 1, false)[0], this.player, this);
    }
    FX.ring(this.player.x, this.player.y, 200, COL.player, 0.6, 4);
    this.grid.force(this.player.x, this.player.y, 500, 300);
    this.nextWave();
  },

  toTitle() {
    this.resetWorld();
    this.state = 'title';
    Sound.setIntensity(0);
    Sound.setMuffled(false);
  },

  pause() {
    this.state = 'paused';
    Sound.setMuffled(true);
  },

  resume() {
    this.state = 'playing';
    Sound.setMuffled(false);
  },

  nextWave() {
    this.wave++;
    this.director.begin(this.wave);
    const boss = this.director.isBoss;
    this.banner = {
      text: `WAVE ${this.wave}`,
      sub: boss ? '⚠  BOSS INCOMING  ⚠' : this.waveHint(this.wave),
      color: boss ? '#ff2e4d' : '#4df3ff', t: 0, dur: 2.2,
    };
    Sound.sfx.waveStart();
  },

  waveHint(n) {
    return {
      1: 'WASD move  ·  hold click to fire  ·  SPACE to dash',
      2: 'swarmers inbound — they weave, keep moving',
      3: 'shooters keep their distance — dash through their shots',
      4: 'tanks split apart when destroyed',
      6: 'dashers flash a line before they lunge',
    }[n] || (n % 5 === 4 ? 'something big is coming...' : '');
  },

  openUpgrades() {
    this.state = 'upgrade';
    this.choices = rollUpgrades(this.player, 3, this.director.isBoss);
    this.cardT = 0; this.cardSounded = 0; this.hover = -1; this.chosen = -1;
    this.cardLatch = Input.mouse.down; // don't let a held fire button pick a card
    this.waveClearing = false; this.vacuum = false;
    this.bullets.length = 0;
    this.ui.cardHover = [0, 0, 0];
    Sound.setMuffled(true);
  },

  chooseUpgrade(i) {
    if (this.chosen >= 0 || !this.choices[i]) return;
    this.chosen = i; this.chosenT = 0.35;
    Sound.sfx.select();
  },

  finishUpgrade() {
    const u = this.choices[this.chosen], p = this.player;
    applyUpgrade(u, p, this);
    FX.burst(p.x, p.y, RARITY[u.rarity].color, 40, 500, 0.7, 2.5);
    FX.ring(p.x, p.y, 160, RARITY[u.rarity].color, 0.5, 4);
    FX.text(p.x, p.y - 40, u.name.toUpperCase(), RARITY[u.rarity].color, 22, { bold: true, life: 1.4, vy: -40 });
    this.grid.force(p.x, p.y, 400, 250);
    this.state = 'playing';
    Sound.setMuffled(false);
    this.nextWave();
  },

  // ---------------------------------------------------------------- update
  update(dt) {
    this.realT += dt;
    if (Input.hit('KeyM')) Sound.toggleMute();
    if (Input.hit('KeyN')) Sound.toggleMusic();
    switch (this.state) {
      case 'title': this.updateTitle(dt); break;
      case 'playing': this.updatePlaying(dt); break;
      case 'paused': this.updatePaused(); break;
      case 'upgrade': this.updateUpgrade(dt); break;
      case 'dying': this.updateDying(dt); break;
      case 'gameover': this.updateGameOver(dt); break;
    }
    this.updateUi(dt);
  },

  updateTitle(dt) {
    this.titleT += dt;
    this.t += dt;
    this.updateCamera(dt);
    // Ambient attract-mode: random neon detonations rippling the grid.
    if (Math.random() < dt * 2.2) {
      const x = rand(200, ARENA_W - 200), y = rand(200, ARENA_H - 200);
      FX.explode(x, y, pick(['#ff3d9a', '#ffe14d', '#4dff88', '#ff8a3d', '#b56bff', '#4df3ff']), rand(0.6, 1.4));
      this.grid.force(x, y, 260, 200);
    }
    FX.update(dt); this.grid.update(dt); Shake.update(dt);
    if (this.titleT > 0.3 && (Input.hit('Enter', 'Space', 'NumpadEnter') || Input.click())) this.startRun();
  },

  updatePlaying(dt) {
    if (Input.hit('KeyP', 'Escape')) { this.pause(); return; }
    if (this.hitstop > 0) { this.hitstop -= dt; Shake.update(dt); return; }
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.simulate(dt * (this.slowmo > 0 ? 0.35 : 1), true);
    // Music follows the danger level.
    const bossAlive = this.boss && !this.boss.dead;
    Sound.setIntensity(bossAlive ? 3 : this.wave >= 4 ? 2 : 1);
  },

  updatePaused() {
    if (Input.hit('KeyP', 'Escape')) this.resume();
    else if (Input.hit('KeyR')) this.startRun();
    else if (Input.hit('KeyQ')) this.toTitle();
  },

  updateUpgrade(dt) {
    this.cardT += dt;
    this.t += dt;
    this.updateCamera(dt);
    FX.update(dt); this.grid.update(dt); Shake.update(dt);
    const rects = UI.cardRects(this);
    while (this.cardSounded < rects.length && this.cardT > this.cardSounded * 0.09 + 0.05) Sound.sfx.cardAppear(this.cardSounded++);

    if (this.chosen >= 0) {
      this.chosenT -= dt;
      if (this.chosenT <= 0) this.finishUpgrade();
      return;
    }
    const m = Input.mouse;
    let h = -1;
    rects.forEach((r, i) => { if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) h = i; });
    if (h !== this.hover && h >= 0) Sound.sfx.hover();
    this.hover = h;
    if (!m.down) this.cardLatch = false;
    const ready = this.cardT > 0.45;
    const clicked = Input.click();
    if (!ready) return;
    if (Input.hit('Digit1', 'Numpad1')) this.chooseUpgrade(0);
    else if (Input.hit('Digit2', 'Numpad2')) this.chooseUpgrade(1);
    else if (Input.hit('Digit3', 'Numpad3')) this.chooseUpgrade(2);
    else if (clicked && !this.cardLatch && h >= 0) this.chooseUpgrade(h);
  },

  updateDying(dt) {
    this.dyingT += dt;
    if (this.hitstop > 0) { this.hitstop -= dt; Shake.update(dt); return; }
    this.simulate(dt * (this.dyingT < 1.4 ? 0.3 : 0.6), false);
    if (this.dyingT > 2.3) {
      this.state = 'gameover';
      this.goT = 0;
      Sound.setMuffled(true);
    }
  },

  updateGameOver(dt) {
    this.goT += dt;
    this.simulate(dt * 0.4, false);
    if (this.goT < 0.8) return;
    if (Input.hit('KeyR')) this.startRun();
    else if (Input.hit('Escape', 'Enter')) this.toTitle();
  },

  updateUi(dt) {
    const p = this.player, u = this.ui;
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    u.hpLag = hpK > u.hpLag ? hpK : lerp(u.hpLag, hpK, damp(2.5, dt));
    u.scoreShown = lerp(u.scoreShown, this.score, damp(9, dt));
    if (Math.abs(u.scoreShown - this.score) < 1) u.scoreShown = this.score;
    u.multPop = Math.max(0, u.multPop - dt);
    for (let i = 0; i < 3; i++) u.cardHover[i] = lerp(u.cardHover[i], this.hover === i ? 1 : 0, damp(14, dt));
    if (this.state === 'gameover') u.goScore = lerp(u.goScore, this.score, damp(3, dt));
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
  },

  // ------------------------------------------------------------ simulation
  simulate(dt, alive) {
    const p = this.player;
    this.t += dt;
    this.tick++;
    if (alive) this.stats.time += dt;
    this.updateCamera(dt);

    if (alive) p.update(dt, this);
    if (alive && !this.waveClearing) this.director.update(dt);
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);
    if (this.purgeT > 0) {
      this.purgeT -= dt;
      for (const e of this.enemies) if (!e.dead && !e.isBoss) this.killEnemy(e, true);
      for (const b of this.ebullets) b.dead = true;
    }
    this.buildGrid();
    this.updateBullets(dt);
    this.updateEnemyBullets(dt, alive);
    if (alive) {
      this.orbitalHits();
      this.dashHits();
      this.contactHits();
    }
    this.updateOrbs(dt, alive);
    this.updateExplosions(dt);

    compact(this.enemies, e => e.dead);
    compact(this.bullets, b => b.dead);
    compact(this.ebullets, b => b.dead);
    compact(this.orbs, o => o.dead);

    FX.update(dt);
    this.grid.update(dt);
    Shake.update(dt);

    // Combo decays one tier at a time if you stop killing.
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.combo = Math.max(0, (Math.floor(this.combo / 10) - 1) * 10);
        this.comboT = this.combo > 0 ? 2 : 0;
        this.lastMult = this.mult;
      }
    }

    if (!alive) return;
    if (!this.waveClearing && this.director.done()) {
      this.waveClearing = true;
      this.vacuum = true;
      this.clearT = 0;
      const bonus = 250 * this.wave * this.mult;
      this.score += bonus;
      this.banner = { text: this.director.isBoss ? 'WARDEN DESTROYED' : `WAVE ${this.wave} CLEARED`, sub: `+${formatNum(bonus)} clear bonus`, color: '#5dffb0', t: 0, dur: 1.9 };
      Sound.sfx.waveClear();
      for (const b of this.ebullets) { FX.burst(b.x, b.y, b.color, 3, 120, 0.3, 1.5); b.dead = true; }
    }
    if (this.waveClearing) {
      this.clearT += dt;
      if ((this.clearT > 1.4 && this.orbs.length === 0) || this.clearT > 3.5) this.openUpgrades();
    }
  },

  updateCamera(dt) {
    const z = this.cam.zoom, p = this.player, m = Input.mouse;
    const halfW = this.W / 2 / z, halfH = this.H / 2 / z;
    this.mouseWorld.x = this.cam.x + (m.x - this.W / 2) / z;
    this.mouseWorld.y = this.cam.y + (m.y - this.H / 2) / z;
    let tx, ty;
    if (this.state === 'title') {
      tx = ARENA_W / 2 + Math.sin(this.titleT * 0.13) * 400;
      ty = ARENA_H / 2 + Math.cos(this.titleT * 0.09) * 250;
    } else {
      // Lead the camera slightly toward the aim point.
      tx = p.x + (this.mouseWorld.x - p.x) * 0.16;
      ty = p.y + (this.mouseWorld.y - p.y) * 0.16;
    }
    const margin = 140;
    tx = ARENA_W + margin * 2 < halfW * 2 ? ARENA_W / 2 : clamp(tx, halfW - margin, ARENA_W - halfW + margin);
    ty = ARENA_H + margin * 2 < halfH * 2 ? ARENA_H / 2 : clamp(ty, halfH - margin, ARENA_H - halfH + margin);
    const k = damp(7, dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  },

  buildGrid() {
    const g = this.egrid, es = this.enemies;
    g.clear();
    for (const e of es) if (!e.dead && e.active) g.insert(e);
    // Soft separation so packs spread into readable shapes instead of stacking.
    for (const e of es) {
      if (e.dead || !e.active) continue;
      const near = g.query(e.x, e.y, e.r + MAX_R, this.tmpB);
      for (const o of near) {
        if (o.id <= e.id || o.dead) continue;
        const dx = o.x - e.x, dy = o.y - e.y, min = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.0001) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        const tm = e.mass + o.mass, ke = o.mass / tm, ko = e.mass / tm;
        const nx = dx / d, ny = dy / d;
        e.x -= nx * push * ke; e.y -= ny * push * ke;
        o.x += nx * push * ko; o.y += ny * push * ko;
      }
    }
  },

  nearestEnemy(x, y, range, filter) {
    let best = null, bd = range * range;
    for (const e of this.egrid.query(x, y, range)) {
      if (e.dead || (filter && !filter(e))) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },

  // --------------------------------------------------------------- weapons
  spawnBullet(x, y, a, dmgMul = 1, nova = false) {
    if (this.bullets.length > 700) return;
    const s = this.player.s;
    const crit = Math.random() < s.crit;
    const spd = s.bulletSpeed * (nova ? 0.8 : 1);
    this.bullets.push({
      id: ++this.bulletId, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      r: s.bulletSize * (crit ? 1.3 : 1),
      dmg: s.damage * dmgMul * (crit ? s.critMult : 1), crit,
      pierce: s.pierce, bounce: s.bounce, homing: s.homing,
      life: nova ? 0.55 : 1.15, hits: [], trail: [x, y], dead: false,
    });
  },

  spawnEnemyBullet(x, y, a, speed, color, r = 6) {
    if (this.ebullets.length > 500) return;
    this.ebullets.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r, color,
      life: 4.5, dmg: Math.round(11 * this.director.scale.dmg), dead: false,
    });
  },

  updateBullets(dt) {
    const s = this.player.s;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }

      if (b.homing && (b.id + this.tick) % 3 === 0) {
        const tgt = this.nearestEnemy(b.x, b.y, 300, e => !b.hits.includes(e.id));
        if (tgt) {
          const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(tgt.y - b.y, tgt.x - b.x);
          const turn = clamp(angleDiff(cur, want), -1, 1) * Math.min(1, 2.2 * b.homing * dt * 3);
          const sp = Math.hypot(b.vx, b.vy), na = cur + turn;
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
        }
      }

      b.trail.push(b.x, b.y);
      if (b.trail.length > 12) b.trail.splice(0, 2);
      b.x += b.vx * dt; b.y += b.vy * dt;

      // Walls
      const outX = b.x < 0 || b.x > ARENA_W, outY = b.y < 0 || b.y > ARENA_H;
      if (outX || outY) {
        if (b.bounce > 0) {
          if (outX) b.vx = -b.vx;
          if (outY) b.vy = -b.vy;
          b.x = clamp(b.x, 0, ARENA_W); b.y = clamp(b.y, 0, ARENA_H);
          b.bounce--;
          b.hits.length = 0;
          FX.burst(b.x, b.y, COL.bullet, 5, 200, 0.2, 1.5);
        } else {
          b.dead = true;
          FX.cone(clamp(b.x, 0, ARENA_W), clamp(b.y, 0, ARENA_H), Math.atan2(-b.vy, -b.vx), 0.9, COL.bullet, 4, 200, 0.2, 1.5);
          continue;
        }
      }

      const cands = this.egrid.query(b.x, b.y, b.r + MAX_R, this.tmpA);
      for (const e of cands) {
        if (e.dead) continue;
        const rr = e.r + b.r;
        if (dist2(b.x, b.y, e.x, e.y) > rr * rr || b.hits.includes(e.id)) continue;
        b.hits.push(e.id);
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const col = b.crit ? COL.crit : COL.bullet;
        this.damageEnemy(e, b.dmg, { crit: b.crit, kx: b.vx / sp * 70, ky: b.vy / sp * 70 });
        FX.cone(b.x, b.y, Math.atan2(-b.vy, -b.vx), 0.8, col, 4, 260, 0.18, 1.5);
        if (s.chain > 0 && Math.random() < s.chain) this.chainLightning(e, b.dmg * 0.7, s.chainJumps);
        if (b.pierce > 0) { b.pierce--; continue; }
        if (b.bounce > 0) {
          const tgt = this.nearestEnemy(b.x, b.y, 420, o => !b.hits.includes(o.id));
          if (tgt) {
            const a = Math.atan2(tgt.y - b.y, tgt.x - b.x);
            b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
            b.bounce--;
            b.life = Math.max(b.life, 0.6);
            break;
          }
        }
        b.dead = true;
        break;
      }
    }
  },

  chainLightning(from, dmg, jumps) {
    let cur = from;
    const hit = [from.id];
    for (let j = 0; j < jumps; j++) {
      const n = this.nearestEnemy(cur.x, cur.y, 220, e => !hit.includes(e.id));
      if (!n) break;
      FX.bolt(cur.x, cur.y, n.x, n.y, COL.chain);
      hit.push(n.id);
      this.damageEnemy(n, dmg, { color: COL.chain });
      cur = n;
    }
    if (hit.length > 1) Sound.sfx.zap();
  },

  updateEnemyBullets(dt, alive) {
    const p = this.player;
    for (const b of this.ebullets) {
      if (b.dead) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > ARENA_W + 20 || b.y < -20 || b.y > ARENA_H + 20) { b.dead = true; continue; }
      if (!alive) continue;
      for (const o of p.orbs) {
        if (dist2(o.x, o.y, b.x, b.y) < (b.r + 10) ** 2) {
          b.dead = true;
          FX.burst(b.x, b.y, COL.orbital, 6, 200, 0.25, 1.5);
          Sound.sfx.block();
          break;
        }
      }
      if (b.dead) continue;
      const rr = b.r + p.hurtR;
      if (p.invuln <= 0 && dist2(p.x, p.y, b.x, b.y) < rr * rr) {
        b.dead = true;
        this.hurtPlayer(b.dmg, b);
      }
    }
  },

  orbitalHits() {
    const p = this.player, s = p.s;
    for (const o of p.orbs) {
      for (const e of this.egrid.query(o.x, o.y, 12 + MAX_R, this.tmpA)) {
        if (e.dead || e.orbHitT > 0) continue;
        const rr = e.r + 11;
        if (dist2(o.x, o.y, e.x, e.y) > rr * rr) continue;
        e.orbHitT = 0.25;
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        this.damageEnemy(e, s.damage * 0.9, { kx: Math.cos(a) * 160, ky: Math.sin(a) * 160 });
        FX.burst(o.x, o.y, COL.orbital, 4, 180, 0.2, 1.5);
      }
    }
  },

  dashHits() {
    const p = this.player, s = p.s;
    if (!p.dashing || s.dashDamage <= 0) return;
    const dmg = s.dashDamage * (s.damage / 10);
    for (const e of this.egrid.query(p.x, p.y, p.r + MAX_R + 8, this.tmpA)) {
      if (e.dead || p.dashHit.has(e.id)) continue;
      const rr = e.r + p.r + 8;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
      p.dashHit.add(e.id);
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      this.damageEnemy(e, dmg, { kx: Math.cos(a) * 300, ky: Math.sin(a) * 300, color: COL.player });
      FX.burst(e.x, e.y, COL.player, 10, 300, 0.3, 2);
      Shake.add(0.05);
    }
  },

  contactHits() {
    const p = this.player;
    if (p.invuln > 0) return;
    for (const e of this.egrid.query(p.x, p.y, p.hurtR + MAX_R, this.tmpA)) {
      if (e.dead) continue;
      const rr = e.r + p.hurtR;
      if (dist2(p.x, p.y, e.x, e.y) < rr * rr) {
        this.hurtPlayer(e.dmg, e);
        // Bounce the attacker back so it doesn't sit on the player through i-frames.
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.vx += Math.cos(a) * 400 / Math.sqrt(e.mass); e.vy += Math.sin(a) * 400 / Math.sqrt(e.mass);
        return;
      }
    }
  },

  // ------------------------------------------------------ damage & rewards
  damageEnemy(e, dmg, o = {}) {
    if (e.dead || !e.active) return;
    e.hp -= dmg;
    e.flash = 0.07;
    if (o.kx !== undefined) { e.vx += o.kx / e.mass; e.vy += o.ky / e.mass; }
    this.stats.dmg += dmg;
    FX.text(e.x, e.y - e.r - 4, String(Math.round(dmg)),
      o.crit ? COL.crit : (o.color || '#ffffff'), o.crit ? 21 : 12,
      { bold: o.crit, life: o.crit ? 0.8 : 0.5 });
    if (o.crit) Sound.sfx.crit(); else Sound.sfx.hit();
    if (e.isBoss) this.grid.force(e.x, e.y, 30, 120);
    if (e.hp <= 0) this.killEnemy(e);
  },

  killEnemy(e, purge = false) {
    if (e.dead) return;
    e.dead = true;
    const p = this.player;
    this.stats.kills++;
    this.combo++;
    this.comboT = 3.5;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    const mult = this.mult;
    if (mult > this.lastMult) { this.ui.multPop = 0.35; }
    this.lastMult = mult;
    const pts = e.score * mult;
    this.score += pts;

    FX.explode(e.x, e.y, e.color, e.fxScale);
    this.grid.force(e.x, e.y, 160 * Math.sqrt(e.fxScale), 100 + 40 * e.fxScale);
    Shake.add(purge ? 0.02 : e.shake);
    if (e.fxScale >= 1.8 && !purge) this.hitStop(0.055);
    if (e.fxScale >= 1.8 || mult >= 4) FX.text(e.x, e.y + 10, '+' + formatNum(pts), '#ffd24d', e.fxScale >= 1.8 ? 18 : 13, { life: 0.9, vy: -30 });
    this.spawnOrbs(e.x, e.y, e.xp);
    if (p.s.lifesteal > 0 && p.hp > 0) p.heal(p.s.lifesteal);
    if (p.s.explosive > 0 && !purge) {
      const lv = p.s.explosive;
      this.explosions.push({ x: e.x, y: e.y, r: 58 + 22 * lv, dmg: p.s.damage * (0.5 + 0.3 * lv), t: 0.06 });
    }
    e.onDeath(this);
    if (e.isBoss) this.bossDefeated(e);
    Sound.sfx.kill(Math.min(2, e.fxScale));
  },

  spawnOrbs(x, y, total) {
    while (total > 0) {
      const v = total >= 10 ? 5 : 1;
      total -= v;
      if (this.orbs.length > 350) {
        // Too many on the floor: fold value into an existing orb instead.
        const o = this.orbs[randInt(0, this.orbs.length - 1)];
        o.v += v; o.r = o.v >= 5 ? 7 : 4.5;
        continue;
      }
      const a = rand(TAU), s = rand(80, 260);
      this.orbs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, v, r: v >= 5 ? 7 : 4.5, t: 0, spd: 0, mag: false, seed: rand(10), dead: false });
    }
  },

  updateOrbs(dt, alive) {
    const p = this.player, mr2 = p.s.magnet * p.s.magnet;
    const fr = Math.exp(-3 * dt);
    for (const o of this.orbs) {
      o.t += dt;
      const dx = p.x - o.x, dy = p.y - o.y, d2 = dx * dx + dy * dy;
      if (alive && o.t > 0.25 && (this.vacuum || d2 < mr2)) o.mag = true;
      if (o.mag && alive) {
        const d = Math.sqrt(d2) || 1;
        o.spd = Math.min(1600, o.spd + 2400 * dt);
        const k = damp(9, dt);
        o.vx += (dx / d * o.spd - o.vx) * k;
        o.vy += (dy / d * o.spd - o.vy) * k;
      } else { o.vx *= fr; o.vy *= fr; }
      o.x = clamp(o.x + o.vx * dt, 5, ARENA_W - 5);
      o.y = clamp(o.y + o.vy * dt, 5, ARENA_H - 5);
      const rr = p.r + o.r + 6;
      if (alive && d2 < rr * rr) {
        o.dead = true;
        this.pickupStreak = this.realT - this.lastPickup < 0.5 ? this.pickupStreak + 1 : 0;
        this.lastPickup = this.realT;
        this.score += o.v * 10;
        FX.burst(o.x, o.y, o.v >= 5 ? COL.xpBig : COL.xp, 3, 120, 0.2, 1.5);
        Sound.sfx.pickup(this.pickupStreak);
        p.addXp(o.v, this);
      }
    }
  },

  updateExplosions(dt) {
    let n = 0;
    for (const ex of this.explosions) {
      ex.t -= dt;
      if (ex.t > 0 || n >= 10) continue;
      n++;
      ex.done = true;
      FX.explode(ex.x, ex.y, COL.explosion, ex.r / 70);
      FX.ring(ex.x, ex.y, ex.r, '#ffcc66', 0.3, 4);
      this.grid.force(ex.x, ex.y, 260, ex.r * 1.8);
      Shake.add(0.07);
      Sound.sfx.explode();
      for (const e of this.egrid.query(ex.x, ex.y, ex.r + MAX_R, this.tmpB)) {
        if (e.dead) continue;
        const rr = ex.r + e.r;
        if (dist2(ex.x, ex.y, e.x, e.y) > rr * rr) continue;
        const a = Math.atan2(e.y - ex.y, e.x - ex.x);
        this.damageEnemy(e, ex.dmg, { kx: Math.cos(a) * 220, ky: Math.sin(a) * 220, color: COL.explosion });
      }
    }
    compact(this.explosions, ex => ex.done);
  },

  levelUp() {
    const p = this.player;
    Sound.sfx.levelUp();
    Sound.sfx.nova();
    FX.ring(p.x, p.y, 280, COL.xp, 0.6, 6);
    FX.ring(p.x, p.y, 200, '#ffffff', 0.4, 3);
    FX.burst(p.x, p.y, COL.xp, 50, 600, 0.8, 2.5);
    FX.text(p.x, p.y - 50, `LEVEL ${p.level}`, COL.xp, 26, { bold: true, life: 1.3, vy: -40 });
    FX.flash(0.15, COL.xp);
    this.grid.force(p.x, p.y, 600, 320);
    Shake.add(0.25);
    p.heal(p.maxHp * 0.1);
    // Level-up nova: shoves back and damages everything nearby, erases bullets.
    for (const e of this.egrid.query(p.x, p.y, 280 + MAX_R, this.tmpB)) {
      if (e.dead) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > 280 + e.r) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      this.damageEnemy(e, 20 + p.level * 4, { kx: Math.cos(a) * 700, ky: Math.sin(a) * 700, color: COL.xp });
    }
    for (const b of this.ebullets) {
      if (dist2(p.x, p.y, b.x, b.y) < 320 * 320) { b.dead = true; FX.burst(b.x, b.y, COL.xp, 3, 150, 0.3, 1.5); }
    }
  },

  hitStop(d) {
    if (d < 0.1 && this.realT - this.lastHitStop < 0.15) return;
    this.hitstop = Math.max(this.hitstop, d);
    this.lastHitStop = this.realT;
  },

  hurtPlayer(dmg, src) {
    const p = this.player;
    if (p.invuln > 0 || p.hp <= 0) return;
    p.hp -= dmg;
    p.invuln = 1.0;
    p.hurtFlash = 0.12;
    const a = Math.atan2(p.y - src.y, p.x - src.x);
    p.vx += Math.cos(a) * 450; p.vy += Math.sin(a) * 450;
    Shake.add(0.55);
    this.hitStop(0.09);
    FX.flash(0.3, COL.hurt);
    FX.burst(p.x, p.y, COL.hurt, 26, 400, 0.5, 2.5);
    FX.text(p.x, p.y - 26, '-' + Math.round(dmg), COL.hurt, 22, { bold: true, life: 0.9 });
    this.grid.force(p.x, p.y, 350, 180);
    if (this.combo >= 5) {
      FX.text(p.x, p.y - 52, 'COMBO LOST', COL.hurt, 18, { bold: true, life: 1.2, vy: -30 });
      Sound.sfx.comboLost();
    }
    this.combo = 0; this.comboT = 0; this.lastMult = 1;
    // Mercy: erase bullets right next to the player so hits don't chain unfairly.
    for (const b of this.ebullets) if (dist2(p.x, p.y, b.x, b.y) < 150 * 150) { b.dead = true; FX.burst(b.x, b.y, b.color, 3, 100, 0.3, 1.5); }
    Sound.sfx.hurt();
    if (p.hp <= 0) this.playerDie();
  },

  playerDie() {
    const p = this.player;
    p.hp = 0;
    p.orbs.length = 0;
    this.state = 'dying';
    this.dyingT = 0;
    this.hitstop = 0.25;
    FX.explode(p.x, p.y, COL.player, 4);
    FX.explode(p.x, p.y, '#ffffff', 2);
    FX.ring(p.x, p.y, 400, COL.player, 1.2, 6);
    FX.ring(p.x, p.y, 250, COL.hurt, 0.9, 4);
    FX.flash(0.8, '#ffffff');
    Shake.add(1);
    this.grid.force(p.x, p.y, 900, 500);
    Sound.sfx.bigExplode();
    Sound.sfx.gameOver();
    Sound.setIntensity(0);
    this.newHigh = this.score > this.highScore;
    if (this.newHigh) { this.highScore = this.score; Store.set('highscore', this.score); }
    if (this.wave > this.bestWave) { this.bestWave = this.wave; Store.set('bestwave', this.wave); }
  },

  onBossSpawn(b) {
    this.boss = b;
    this.banner = { text: 'WARNING', sub: b.name + ' APPROACHES', color: '#ff2e4d', t: 0, dur: 2.6 };
    Sound.sfx.bossSpawn();
    Sound.setIntensity(3);
    FX.ring(b.x, b.y, 300, b.color, 2.2, 5);
    Shake.add(0.4);
  },

  bossPhaseShift(b) {
    FX.flash(0.3, b.phase === 3 ? '#ff2ee0' : '#ff4d2e');
    FX.ring(b.x, b.y, 350, '#ffffff', 0.6, 6);
    FX.burst(b.x, b.y, b.color, 60, 700, 0.9, 3);
    FX.text(b.x, b.y - 90, b.phase === 3 ? 'OVERLOAD' : 'ENRAGED', '#ff4d7a', 30, { bold: true, life: 1.5, vy: -30 });
    this.grid.force(b.x, b.y, 800, 400);
    Shake.add(0.6);
    this.hitStop(0.12);
    Sound.sfx.bigExplode();
  },

  bossDefeated(b) {
    this.stats.bosses++;
    this.director.queue.length = 0; // escorts still queued would stall the wave

    this.hitStop(0.3);
    this.slowmo = 1.6;
    this.purgeT = 0.5;
    FX.flash(0.7, '#ffffff');
    Shake.add(1);
    for (let i = 0; i < 6; i++) {
      const a = rand(TAU), d = rand(0, 90);
      FX.explode(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, pick([b.color, '#ffffff', '#ffd24d', '#ff2ee0']), rand(2, 4));
    }
    FX.ring(b.x, b.y, 700, '#ffffff', 1.4, 8);
    FX.ring(b.x, b.y, 450, b.color, 1.0, 5);
    FX.text(b.x, b.y - 80, '+' + formatNum(b.score * this.mult), '#ffd24d', 36, { bold: true, life: 2, vy: -25 });
    this.grid.force(b.x, b.y, 1400, 700);
    Sound.sfx.bigExplode();
    this.player.heal(this.player.maxHp * 0.35);
  },

  // ---------------------------------------------------------------- render
  render() {
    const c = this.sctx, W = this.W, H = this.H, z = this.cam.zoom;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#03040b';
    c.fillRect(0, 0, W, H);

    const sh = Shake.offset();
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(sh.rot);
    c.scale(z, z);
    c.translate(-this.cam.x + sh.x, -this.cam.y + sh.y);
    const view = {
      x0: this.cam.x - W / 2 / z - 60, x1: this.cam.x + W / 2 / z + 60,
      y0: this.cam.y - H / 2 / z - 60, y1: this.cam.y + H / 2 / z + 60,
    };
    this.drawWorld(c, view);
    c.restore();
    // Vignette the world only, so the HUD in the corners stays crisp.
    c.drawImage(this.vignette, 0, 0, W, H);

    UI.draw(c, this);
    this.composite();
  },

  drawWorld(c, view) {
    this.grid.draw(c, view, COL.grid);

    // Arena wall: bright, glows harder when the player hugs it.
    const p = this.player;
    const edge = Math.min(p.x, p.y, ARENA_W - p.x, ARENA_H - p.y);
    const near = this.state === 'title' ? 0 : clamp(1 - edge / 200, 0, 1);
    const hue = (this.t * 20) % 360;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `hsl(${hue}, 100%, 60%)`;
    c.globalAlpha = 0.25 + near * 0.3;
    c.lineWidth = 14;
    c.strokeRect(-4, -4, ARENA_W + 8, ARENA_H + 8);
    c.globalAlpha = 0.9;
    c.lineWidth = 3;
    c.strokeRect(-4, -4, ARENA_W + 8, ARENA_H + 8);
    c.restore();

    const inView = (x, y, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

    drawOrbs(c, this.orbs.filter(o => inView(o.x, o.y, 20)), this.t);

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const e of this.enemies) if (e.isBoss || inView(e.x, e.y, e.r + 50)) e.draw(c);
    c.restore();

    drawEnemyBullets(c, this.ebullets, this.t);
    drawBullets(c, this.bullets);
    if (this.state !== 'title') p.draw(c, this);
    FX.draw(c);
    FX.drawTexts(c);
  },

  composite() {
    const m = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    const [b1, b2, b3] = this.blurs;
    // Progressive half-res downsamples act as a cheap wide blur for bloom.
    b1.x.clearRect(0, 0, b1.c.width, b1.c.height);
    b1.x.drawImage(this.scene, 0, 0, b1.c.width, b1.c.height);
    b2.x.clearRect(0, 0, b2.c.width, b2.c.height);
    b2.x.drawImage(b1.c, 0, 0, b2.c.width, b2.c.height);
    b3.x.clearRect(0, 0, b3.c.width, b3.c.height);
    b3.x.drawImage(b2.c, 0, 0, b3.c.width, b3.c.height);

    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.imageSmoothingEnabled = true;
    m.drawImage(this.scene, 0, 0);
    m.globalCompositeOperation = 'lighter';
    m.globalAlpha = 0.45;
    m.drawImage(b2.c, 0, 0, cw, ch);
    m.globalAlpha = 0.6;
    m.drawImage(b3.c, 0, 0, cw, ch);
    m.globalCompositeOperation = 'source-over';

    const p = this.player;
    const playing = this.state === 'playing' || this.state === 'upgrade' || this.state === 'paused';
    if (playing && p.hp < p.maxHp * 0.3) {
      m.globalAlpha = 0.5 + 0.35 * Math.sin(this.realT * 7);
      m.drawImage(this.redVignette, 0, 0, cw, ch);
    }
    if (FX.flashA > 0) {
      m.globalAlpha = FX.flashA * 0.6;
      m.fillStyle = FX.flashColor;
      m.fillRect(0, 0, cw, ch);
    }
    m.globalAlpha = 1;
  },
};

window.addEventListener('load', () => Game.init());
