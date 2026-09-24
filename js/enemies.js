'use strict';
// ---------------------------------------------------------------------------
// Enemies. Each type has a distinct movement "verb" so the player reads the
// arena at a glance: chasers home, swarmers weave in packs, tanks plod and
// burst into shards, shooters kite at range, dashers telegraph and lunge,
// and the Warden boss cycles bullet patterns across three phases.
// ---------------------------------------------------------------------------

let ENEMY_ID = 0;

class Enemy {
  constructor(x, y, cfg, sc) {
    this.id = ++ENEMY_ID;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.r = cfg.r;
    this.hp = this.maxHp = cfg.hp * sc.hp;
    this.speed = cfg.speed * sc.spd;
    this.dmg = Math.round(cfg.dmg * sc.dmg);
    this.color = cfg.color;
    this.score = cfg.score;
    this.xp = cfg.xp;
    this.mass = cfg.mass || 1;
    this.fxScale = cfg.fxScale || 1;
    this.shake = cfg.shake || 0.08;
    this.spawnT = cfg.spawnT !== undefined ? cfg.spawnT : 0.75;
    this.spawnMax = this.spawnT;
    this.flash = 0;
    this.orbHitT = 0;
    this.t = rand(0, 10);
    this.angle = rand(TAU);
    this.dead = false;
    this.sc = sc;
  }

  get active() { return this.spawnT <= 0; }

  steer(tx, ty, speed, rate, dt) {
    const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1;
    const k = damp(rate, dt);
    this.vx += (dx / d * speed - this.vx) * k;
    this.vy += (dy / d * speed - this.vy) * k;
  }

  update(dt, g) {
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    this.t += dt;
    this.flash -= dt;
    this.orbHitT -= dt;
    this.think(dt, g);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const r = this.r;
    if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx); this.onWall(g); }
    if (this.x > ARENA_W - r) { this.x = ARENA_W - r; this.vx = -Math.abs(this.vx); this.onWall(g); }
    if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy); this.onWall(g); }
    if (this.y > ARENA_H - r) { this.y = ARENA_H - r; this.vy = -Math.abs(this.vy); this.onWall(g); }
  }

  think() {}
  onWall() {}
  onDeath() {}
  drawBody() {}
  drawTelegraph() {}

  draw(ctx) {
    if (this.spawnT > 0) {
      // Spawn warning: converging ring + faint silhouette so spawns are never cheap.
      const k = 1 - this.spawnT / this.spawnMax;
      ctx.globalAlpha = 0.35 + 0.4 * Math.sin(k * 30) ** 2;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + (1 - k) * 40, 0, TAU); ctx.stroke();
      ctx.globalAlpha = k * 0.5;
      this.drawBody(ctx, this.color);
      ctx.globalAlpha = 1;
      return;
    }
    this.drawTelegraph(ctx);
    this.drawBody(ctx, this.flash > 0 ? '#ffffff' : this.color);
  }
}

// Shared polygon helper.
function poly(ctx, x, y, r, sides, angle, color, fillA = 0.15, lw = 2.5) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = angle + i * TAU / sides;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  const ga = ctx.globalAlpha;
  ctx.fillStyle = color; ctx.globalAlpha = ga * fillA; ctx.fill();
  ctx.globalAlpha = ga;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
}

// --- Chaser: relentless homing diamond -------------------------------------
class Chaser extends Enemy {
  constructor(x, y, sc) {
    super(x, y, { r: 14, hp: 20, speed: 118, dmg: 14, color: '#ff3d9a', score: 100, xp: 2 }, sc);
  }
  think(dt, g) {
    this.steer(g.player.x, g.player.y, this.speed, 2.6, dt);
    this.angle += dt * 3;
  }
  drawBody(ctx, c) {
    const sx = 1 + Math.sin(this.t * 6) * 0.08;
    poly(ctx, this.x, this.y, this.r * sx, 4, this.angle, c);
    poly(ctx, this.x, this.y, this.r * 0.45, 4, -this.angle, c, 0.4, 1.5);
  }
}

// --- Swarmer: fast, fragile, weaving pack hunter ---------------------------
class Swarmer extends Enemy {
  constructor(x, y, sc) {
    super(x, y, { r: 9, hp: 10, speed: 205, dmg: 9, color: '#ffe14d', score: 50, xp: 1, fxScale: 0.6 }, sc);
    this.phase = rand(TAU);
    this.freq = rand(3, 5);
    this.spawnT = rand(0.5, 0.8);
    this.spawnMax = this.spawnT;
  }
  think(dt, g) {
    const dx = g.player.x - this.x, dy = g.player.y - this.y, d = Math.hypot(dx, dy) || 1;
    // Sideways weave that tightens as it closes in.
    const w = Math.sin(this.t * this.freq + this.phase) * Math.min(1, d / 300) * 0.9;
    const px = -dy / d, py = dx / d;
    const tx = dx / d + px * w, ty = dy / d + py * w;
    const k = damp(3, dt);
    this.vx += (tx * this.speed - this.vx) * k;
    this.vy += (ty * this.speed - this.vy) * k;
    this.angle = Math.atan2(this.vy, this.vx);
  }
  drawBody(ctx, c) {
    poly(ctx, this.x, this.y, this.r, 3, this.angle, c, 0.3, 2);
  }
}

// --- Tank: slow bruiser that bursts into shards ----------------------------
class Tank extends Enemy {
  constructor(x, y, sc) {
    super(x, y, { r: 27, hp: 130, speed: 52, dmg: 24, color: '#4dff88', score: 400, xp: 7, mass: 7, fxScale: 1.8, shake: 0.3, spawnT: 1.0 }, sc);
  }
  think(dt, g) {
    this.steer(g.player.x, g.player.y, this.speed, 1.2, dt);
    this.angle += dt * 0.8;
  }
  onDeath(g) {
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + rand(-0.3, 0.3);
      const s = new Shard(this.x + Math.cos(a) * 12, this.y + Math.sin(a) * 12, this.sc);
      s.vx = Math.cos(a) * 320; s.vy = Math.sin(a) * 320;
      g.enemies.push(s);
    }
  }
  drawBody(ctx, c) {
    const hpK = this.hp / this.maxHp;
    poly(ctx, this.x, this.y, this.r, 6, this.angle, c, 0.12, 3);
    poly(ctx, this.x, this.y, this.r * 0.62, 6, -this.angle * 1.5, c, 0.2, 2);
    // Core shrinks as it takes damage — readable progress on a tanky target.
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(this.x, this.y, 3 + 6 * hpK, 0, TAU); ctx.fill();
  }
}

class Shard extends Enemy {
  constructor(x, y, sc) {
    super(x, y, { r: 10, hp: 16, speed: 165, dmg: 9, color: '#b6ff4d', score: 50, xp: 1, fxScale: 0.6, spawnT: 0 }, sc);
    this.stun = 0.35;
  }
  think(dt, g) {
    if (this.stun > 0) {
      this.stun -= dt;
      const d = Math.exp(-4 * dt); this.vx *= d; this.vy *= d;
    } else {
      this.steer(g.player.x, g.player.y, this.speed, 3, dt);
    }
    this.angle += dt * 8;
  }
  drawBody(ctx, c) { poly(ctx, this.x, this.y, this.r, 3, this.angle, c, 0.25, 2); }
}

// --- Shooter: keeps its distance and fires telegraphed shots ---------------
class Shooter extends Enemy {
  constructor(x, y, sc, wave) {
    super(x, y, { r: 15, hp: 40, speed: 95, dmg: 12, color: '#ff8a3d', score: 200, xp: 3 }, sc);
    this.orbitDir = randSign();
    this.cd = rand(1.2, 2.2);
    this.charge = 0;
    this.burst = wave >= 8 ? 3 : 1;
    this.aim = 0;
  }
  think(dt, g) {
    const p = g.player;
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    let fwd = d > 390 ? 1 : d < 270 ? -1 : 0;
    const tx = nx * fwd + -ny * this.orbitDir * 0.7, ty = ny * fwd + nx * this.orbitDir * 0.7;
    const k = damp(2, dt), spd = this.charge > 0 ? this.speed * 0.25 : this.speed;
    this.vx += (tx * spd - this.vx) * k;
    this.vy += (ty * spd - this.vy) * k;
    this.aim = Math.atan2(dy, dx);
    this.angle += dt;

    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) {
        const bs = 240 * Math.min(1.35, this.sc.spd);
        for (let i = 0; i < this.burst; i++) {
          const a = this.aim + (i - (this.burst - 1) / 2) * 0.22;
          g.spawnEnemyBullet(this.x + Math.cos(a) * 18, this.y + Math.sin(a) * 18, a, bs, this.color);
        }
        FX.cone(this.x, this.y, this.aim, 0.4, this.color, 6, 250, 0.2);
        Sound.sfx.enemyShoot();
        this.cd = rand(2.0, 2.8) / Math.min(1.5, this.sc.spd);
      }
    } else if (d < 800) {
      this.cd -= dt;
      if (this.cd <= 0) this.charge = 0.6;
    }
  }
  drawBody(ctx, c) {
    poly(ctx, this.x, this.y, this.r, 4, this.angle + Math.PI / 4, c, 0.15, 2.5);
    // Barrel
    ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.aim) * (this.r + 8), this.y + Math.sin(this.aim) * (this.r + 8));
    ctx.stroke();
    if (this.charge > 0) {
      const k = 1 - this.charge / 0.6;
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.4 + k * 0.6;
      ctx.beginPath(); ctx.arc(this.x, this.y, 3 + k * 7, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// --- Dasher: winds up, shows its line, then lunges -------------------------
class Dasher extends Enemy {
  constructor(x, y, sc) {
    super(x, y, { r: 14, hp: 35, speed: 95, dmg: 20, color: '#b56bff', score: 250, xp: 3 }, sc);
    this.state = 'seek';
    this.st = rand(1, 2);
    this.dir = 0;
  }
  think(dt, g) {
    const p = g.player;
    this.st -= dt;
    switch (this.state) {
      case 'seek': {
        this.steer(p.x, p.y, this.speed, 2, dt);
        this.dir = Math.atan2(p.y - this.y, p.x - this.x);
        if (this.st <= 0 && dist2(p.x, p.y, this.x, this.y) < 420 * 420) {
          this.state = 'wind'; this.st = 0.7;
          Sound.sfx.charge();
        }
        break;
      }
      case 'wind': {
        const d = Math.exp(-8 * dt); this.vx *= d; this.vy *= d;
        // Tracks the player until the final 0.25s, then locks — dodgeable.
        if (this.st > 0.25) this.dir = Math.atan2(p.y - this.y, p.x - this.x);
        if (this.st <= 0) {
          this.state = 'dash'; this.st = 0.42;
          const s = 720 * Math.min(1.3, this.sc.spd);
          this.vx = Math.cos(this.dir) * s; this.vy = Math.sin(this.dir) * s;
        }
        break;
      }
      case 'dash': {
        if (Math.random() < 0.6) FX.spawn(this.x, this.y, rand(-30, 30), rand(-30, 30), 0.3, 3, this.color, PK_DOT, 2);
        g.grid.force(this.x, this.y, 30, 60);
        if (this.st <= 0) { this.state = 'rest'; this.st = 0.7; }
        break;
      }
      case 'rest': {
        const d = Math.exp(-5 * dt); this.vx *= d; this.vy *= d;
        if (this.st <= 0) { this.state = 'seek'; this.st = rand(0.8, 1.6); }
        break;
      }
    }
    this.angle = this.dir;
  }
  drawTelegraph(ctx) {
    if (this.state !== 'wind') return;
    const k = 1 - this.st / 0.7;
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.15 + 0.45 * k;
    ctx.lineWidth = 2 + k * 8;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.dir) * 310, this.y + Math.sin(this.dir) * 310);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  drawBody(ctx, c) {
    const shake = this.state === 'wind' ? rand(-2, 2) : 0;
    const x = this.x + shake, y = this.y + shake, a = this.angle, r = this.r;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4);
    ctx.lineTo(x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r);
    ctx.lineTo(x + Math.cos(a + Math.PI) * r * 0.3, y + Math.sin(a + Math.PI) * r * 0.3);
    ctx.lineTo(x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r);
    ctx.closePath();
    ctx.fillStyle = c; ctx.globalAlpha = this.state === 'dash' ? 0.6 : 0.2; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
  }
}

// --- Boss: The Warden -------------------------------------------------------
class Boss extends Enemy {
  constructor(x, y, sc, tier) {
    super(x, y, {
      r: 60, hp: 2000 * (1 + 0.6 * (tier - 1)), speed: 70, dmg: 28, color: '#ff2e4d',
      score: 5000 * tier, xp: 50 + 20 * tier, mass: 60, fxScale: 5, shake: 1, spawnT: 2.4,
    }, sc);
    this.tier = tier;
    this.isBoss = true;
    this.phase = 1;
    this.state = 'idle';
    this.st = 1.5;
    this.spin = 0;
    this.shotT = 0;
    this.bursts = 0;
    this.chargeDir = 0;
    this.lastAttack = '';
    this.name = tier === 1 ? 'THE WARDEN' : `THE WARDEN  MK-${['I', 'II', 'III', 'IV', 'V', 'VI'][Math.min(tier - 1, 5)]}`;
  }

  get hpK() { return this.hp / this.maxHp; }

  think(dt, g) {
    const p = g.player;
    const newPhase = this.hpK > 0.66 ? 1 : this.hpK > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      g.bossPhaseShift(this);
    }
    const haste = 1 + (this.phase - 1) * 0.3;
    this.st -= dt * haste;
    this.angle += dt * (0.6 + this.phase * 0.3);
    g.grid.force(this.x, this.y, -14, 190);

    const bs = 185 + 20 * this.phase + 10 * (this.tier - 1);
    switch (this.state) {
      case 'idle': {
        const d = dist(p.x, p.y, this.x, this.y);
        const want = d > 320 ? this.speed : d < 220 ? -this.speed : 0;
        this.steer(p.x, p.y, want * haste, 1.5, dt);
        if (this.st <= 0) this.pickAttack();
        break;
      }
      case 'spiral': {
        this.slow(dt);
        const arms = this.phase >= 2 ? 4 : 3;
        this.spin += dt * (1.8 + this.phase * 0.25) * (this.tier % 2 ? 1 : -1);
        this.shotT -= dt;
        if (this.shotT <= 0) {
          this.shotT = 0.13 - this.phase * 0.012;
          for (let i = 0; i < arms; i++) g.spawnEnemyBullet(this.x, this.y, this.spin + i * TAU / arms, bs, '#ff4d7a', 7);
          if (this.phase === 3) g.spawnEnemyBullet(this.x, this.y, -this.spin * 1.3, bs * 0.8, '#ff9a3d', 6);
          Sound.sfx.enemyShoot();
        }
        if (this.st <= 0) this.toIdle();
        break;
      }
      case 'ring': {
        this.slow(dt);
        if (this.st <= 0) {
          const n = 16 + this.phase * 4, off = this.bursts * 0.5 * TAU / n;
          for (let i = 0; i < n; i++) g.spawnEnemyBullet(this.x, this.y, off + i * TAU / n, bs * 1.1, '#ff2e4d', 8);
          FX.ring(this.x, this.y, 120, this.color, 0.4, 5);
          Shake.add(0.15);
          Sound.sfx.explode();
          this.bursts--;
          this.st = 0.55;
          if (this.bursts <= 0) this.toIdle();
        }
        break;
      }
      case 'aimed': {
        this.slow(dt);
        if (this.st <= 0) {
          const a = Math.atan2(p.y - this.y, p.x - this.x);
          for (let i = -3; i <= 3; i++) g.spawnEnemyBullet(this.x, this.y, a + i * 0.13, bs * 1.35, '#ffb04d', 7);
          Sound.sfx.enemyShoot();
          this.bursts--;
          this.st = 0.4;
          if (this.bursts <= 0) this.toIdle();
        }
        break;
      }
      case 'summon': {
        this.slow(dt);
        g.grid.force(this.x, this.y, -40, 260);
        if (this.st <= 0) {
          const n = 4 + this.phase * 2;
          for (let i = 0; i < n; i++) {
            const a = i * TAU / n, R = this.r + 50;
            const x = clamp(this.x + Math.cos(a) * R, 30, ARENA_W - 30), y = clamp(this.y + Math.sin(a) * R, 30, ARENA_H - 30);
            const e = i % 3 === 2 ? new Chaser(x, y, g.director.scale) : new Swarmer(x, y, g.director.scale);
            e.spawnT = e.spawnMax = 0.5;
            g.enemies.push(e);
          }
          FX.ring(this.x, this.y, 200, '#ffe14d', 0.5, 4);
          this.toIdle();
        }
        break;
      }
      case 'windup': {
        this.slow(dt);
        if (this.st > 0.3) this.chargeDir = Math.atan2(p.y - this.y, p.x - this.x);
        if (this.st <= 0) {
          this.state = 'charge'; this.st = 1.1;
          const s = 600 + this.phase * 60;
          this.vx = Math.cos(this.chargeDir) * s; this.vy = Math.sin(this.chargeDir) * s;
          Shake.add(0.3);
          Sound.sfx.dash();
        }
        break;
      }
      case 'charge': {
        FX.spawn(this.x + rand(-30, 30), this.y + rand(-30, 30), 0, 0, 0.4, 6, this.color, PK_DOT, 0);
        if (this.st <= 0) { this.vx *= 0.2; this.vy *= 0.2; this.toIdle(); }
        break;
      }
    }
  }

  slow(dt) { const d = Math.exp(-4 * dt); this.vx *= d; this.vy *= d; }

  toIdle() { this.state = 'idle'; this.st = [0, 1.4, 1.0, 0.7][this.phase]; }

  pickAttack() {
    const pool = ['spiral', 'ring', 'windup'];
    if (this.phase >= 2) pool.push('summon', 'aimed');
    if (this.phase >= 3) pool.push('windup', 'aimed');
    let a;
    do { a = pick(pool); } while (a === this.lastAttack && pool.length > 1);
    this.lastAttack = a;
    this.state = a;
    if (a === 'spiral') this.st = 3.2;
    if (a === 'ring') { this.st = 0.5; this.bursts = 2 + this.phase; }
    if (a === 'aimed') { this.st = 0.5; this.bursts = 3; }
    if (a === 'summon') { this.st = 1.0; Sound.sfx.charge(); }
    if (a === 'windup') { this.st = 0.95; Sound.sfx.charge(); }
  }

  onWall(g) {
    if (this.state === 'charge') {
      Shake.add(0.45);
      FX.burst(this.x, this.y, this.color, 20, 400, 0.5, 3);
      g.grid.force(this.x, this.y, 400, 220);
      Sound.sfx.explode();
      // Wall slam scatters shrapnel in phase 2+.
      if (this.phase >= 2) {
        for (let i = 0; i < 10; i++) g.spawnEnemyBullet(this.x, this.y, i * TAU / 10, 170, '#ff9a3d', 6);
      }
    }
  }

  drawTelegraph(ctx) {
    if (this.state === 'windup') {
      const k = 1 - clamp(this.st / 0.95, 0, 1);
      ctx.strokeStyle = this.color;
      ctx.globalAlpha = 0.2 + 0.5 * k;
      ctx.lineWidth = this.r * 1.6 * (0.3 + 0.7 * k);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(this.chargeDir) * 900, this.y + Math.sin(this.chargeDir) * 900);
      ctx.globalAlpha *= 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawBody(ctx, c) {
    const x = this.x, y = this.y, r = this.r;
    const col = this.flash > 0 ? '#ffffff' : this.phase === 3 ? '#ff2ee0' : this.phase === 2 ? '#ff4d2e' : c;
    // Spiked outer star
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = this.angle + i * TAU / 14, rr = i % 2 ? r * 0.78 : r * 1.08;
      i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = col; ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    poly(ctx, x, y, r * 0.6, 3, -this.angle * 1.7, col, 0.15, 2.5);
    poly(ctx, x, y, r * 0.35, 3, -this.angle * 1.7 + Math.PI, col, 0.15, 2);
    const pulse = 1 + Math.sin(this.t * (6 + this.phase * 3)) * 0.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 8 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(x, y, 22 * pulse, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}
