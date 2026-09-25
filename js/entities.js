'use strict';
// ---------------------------------------------------------------------------
// Player ship, player bullets, enemy bullets and XP orbs.
// ---------------------------------------------------------------------------

const COL = {
  player: '#4df3ff',
  bullet: '#aefcff',
  crit: '#ffe14d',
  ebullet: '#ff5a3d',
  xp: '#5dffb0',
  xpBig: '#ffd24d',
  grid: '#3446ff',
  hurt: '#ff2e55',
  orbital: '#7dfcff',
  explosion: '#ff9a3d',
  chain: '#8ff0ff',
};

const ARENA_W = 2400, ARENA_H = 1600;

// Shared ship silhouette (also used for dash afterimages).
function drawShip(ctx, x, y, angle, color, alphaFill = 0.18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(19, 0);
  ctx.lineTo(-12, -12);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha *= alphaFill;
  ctx.fill();
  ctx.globalAlpha /= alphaFill;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.r = 13;        // visual radius
    this.hurtR = 8;     // forgiving hitbox
    this.angle = -Math.PI / 2;
    this.maxHp = 100; this.hp = 100;
    this.s = {
      speed: 275, fireRate: 5.5, damage: 10, bulletSpeed: 840, bulletSize: 4,
      pierce: 0, projectiles: 1, crit: 0.05, critMult: 2.5,
      chain: 0, chainJumps: 2, lifesteal: 0,
      dashDist: 190, dashCd: 1.15, dashDamage: 0,
      magnet: 120, xpMult: 1, explosive: 0, bounce: 0, homing: 0,
      rear: 0, orbitals: 0, nova: 0, regen: 0,
    };
    this.upgrades = {};   // id -> level
    this.upgradeOrder = [];
    this.fireT = 0;
    this.dashT = 0; this.dashCdT = 0; this.dashBuffer = 0;
    this.dashVx = 0; this.dashVy = 0; this.ghostT = 0;
    this.dashHit = new Set();
    this.invuln = 0; this.hurtFlash = 0;
    this.orbAngle = 0; this.orbs = [];
    this.level = 1; this.xp = 0; this.xpNext = 12;
    this.heartT = 0; this.readyFlash = 0;
    this.engineT = 0;
  }

  get dashing() { return this.dashT > 0; }

  heal(n) {
    if (n <= 0 || this.hp <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  update(dt, g) {
    const s = this.s;
    let mx = 0, my = 0;
    if (Input.isDown('KeyA', 'ArrowLeft')) mx -= 1;
    if (Input.isDown('KeyD', 'ArrowRight')) mx += 1;
    if (Input.isDown('KeyW', 'ArrowUp')) my -= 1;
    if (Input.isDown('KeyS', 'ArrowDown')) my += 1;
    const ml = Math.hypot(mx, my);
    if (ml > 0) { mx /= ml; my /= ml; }

    this.angle = Math.atan2(g.mouseWorld.y - this.y, g.mouseWorld.x - this.x);

    // Dash (buffered so an early press still fires when the cooldown ends).
    if (Input.hit('Space', 'ShiftLeft')) this.dashBuffer = 0.18;
    this.dashBuffer -= dt;
    const wasReady = this.dashCdT <= 0;
    this.dashCdT -= dt;
    if (!wasReady && this.dashCdT <= 0) this.readyFlash = 0.25;
    if (this.dashBuffer > 0 && this.dashCdT <= 0 && !this.dashing) this.startDash(mx, my, g);

    if (this.dashing) {
      this.dashT -= dt;
      this.x += this.dashVx * dt; this.y += this.dashVy * dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.018;
        const p = FX.spawn(this.x, this.y, 0, 0, 0.28, 1, COL.player, PK_GHOST, 0);
        if (p) p.angle = Math.atan2(this.dashVy, this.dashVx);
      }
      g.grid.force(this.x, this.y, 60, 70);
      if (this.dashT <= 0) this.endDash(g);
    } else {
      const k = damp(ml > 0 ? 16 : 10, dt);
      this.vx += (mx * s.speed - this.vx) * k;
      this.vy += (my * s.speed - this.vy) * k;
      this.x += this.vx * dt; this.y += this.vy * dt;
    }

    // Arena walls.
    const r = this.r;
    if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > ARENA_W - r) { this.x = ARENA_W - r; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy) * 0.3; }
    if (this.y > ARENA_H - r) { this.y = ARENA_H - r; this.vy = -Math.abs(this.vy) * 0.3; }

    // Engine exhaust.
    const spd = Math.hypot(this.vx, this.vy);
    this.engineT -= dt;
    if (spd > 40 && this.engineT <= 0 && !this.dashing) {
      this.engineT = 0.02;
      const a = Math.atan2(this.vy, this.vx) + Math.PI + rand(-0.3, 0.3);
      FX.spawn(this.x + Math.cos(a) * 10, this.y + Math.sin(a) * 10,
        Math.cos(a) * rand(60, 140), Math.sin(a) * rand(60, 140), rand(0.2, 0.35), rand(1.5, 2.5), '#3aa8ff', PK_DOT, 4);
    }
    if (spd > 60) g.grid.force(this.x, this.y, 8, 50);

    // Weapons.
    this.fireT = Math.max(0, this.fireT - dt);
    if (Input.mouse.down && this.fireT === 0) {
      this.fire(g);
      this.fireT = 1 / s.fireRate;
    }

    // Orbitals.
    this.orbAngle += dt * 3.3;
    this.orbs.length = 0;
    const n = s.orbitals, orad = 64 + n * 4;
    for (let i = 0; i < n; i++) {
      const a = this.orbAngle + i * TAU / n;
      this.orbs.push({ x: this.x + Math.cos(a) * orad, y: this.y + Math.sin(a) * orad });
    }

    if (s.regen > 0) this.heal(s.regen * dt);
    this.invuln -= dt;
    this.hurtFlash -= dt;
    this.readyFlash -= dt;

    // Low-health heartbeat.
    if (this.hp < this.maxHp * 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.heartT = 0.9; Sound.sfx.heartbeat(); }
    }
  }

  startDash(mx, my, g) {
    const s = this.s;
    let dx = mx, dy = my;
    if (dx === 0 && dy === 0) { dx = Math.cos(this.angle); dy = Math.sin(this.angle); }
    const dur = 0.16;
    this.dashT = dur;
    this.dashVx = dx * s.dashDist / dur;
    this.dashVy = dy * s.dashDist / dur;
    this.vx = dx * s.speed; this.vy = dy * s.speed;
    this.dashCdT = s.dashCd;
    this.dashBuffer = 0;
    this.invuln = Math.max(this.invuln, dur + 0.12);
    this.dashHit.clear();
    Sound.sfx.dash();
    Shake.add(0.12);
    FX.cone(this.x, this.y, Math.atan2(-dy, -dx), 0.6, COL.player, 12, 380, 0.3, 2);
  }

  endDash(g) {
    const s = this.s;
    if (s.nova > 0) {
      const n = 4 + s.nova * 4, off = Math.random() * TAU;
      for (let i = 0; i < n; i++) g.spawnBullet(this.x, this.y, off + i * TAU / n, 0.7, true);
      FX.ring(this.x, this.y, 90, COL.player, 0.3, 3);
      Sound.sfx.nova();
    }
  }

  fire(g) {
    const s = this.s, n = s.projectiles;
    const spread = Math.min(0.13 * (n - 1), 0.85);
    const nx = Math.cos(this.angle), ny = Math.sin(this.angle);
    const mx = this.x + nx * 18, my = this.y + ny * 18;
    for (let i = 0; i < n; i++) {
      const a = this.angle + (n > 1 ? -spread / 2 + spread * i / (n - 1) : 0) + rand(-0.025, 0.025);
      g.spawnBullet(mx, my, a);
    }
    for (let i = 0; i < s.rear; i++) {
      const a = this.angle + Math.PI + (s.rear > 1 ? (i - 0.5) * 0.35 : 0);
      g.spawnBullet(this.x - nx * 10, this.y - ny * 10, a);
    }
    FX.cone(mx, my, this.angle, 0.35, COL.bullet, 3, 300, 0.12, 1.5);
    this.vx -= nx * 14; this.vy -= ny * 14;
    Shake.kick(-nx * 1.5, -ny * 1.5);
    Sound.sfx.shoot();
  }

  addXp(v, g) {
    this.xp += v * this.s.xpMult;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(this.xpNext * 1.2 + 6);
      g.levelUp();
    }
  }

  draw(ctx, g) {
    // Orbitals
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of this.orbs) {
      ctx.fillStyle = COL.orbital;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(o.x, o.y, 13, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COL.orbital; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(o.x, o.y, 8, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(o.x, o.y, 3.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    if (this.hp <= 0) return;
    // Blink while in post-hit i-frames (not during a dash, which has its own look).
    if (this.invuln > 0 && !this.dashing && Math.floor(this.invuln * 16) % 2 === 0) return;

    const col = this.hurtFlash > 0 ? '#ffffff' : COL.player;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Soft halo
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = COL.player;
    ctx.beginPath(); ctx.arc(this.x, this.y, 22, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    const face = Faces.get('player');
    if (face) {
      drawFace(ctx, face, this.x, this.y, 19, col, this.hurtFlash > 0);
      // Nose arrow so you can always see where you're aiming.
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const tx = this.x + ca * 32, ty = this.y + sa * 32;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ca * 10 - sa * 7, ty - sa * 10 + ca * 7);
      ctx.lineTo(tx - ca * 10 + sa * 7, ty - sa * 10 - ca * 7);
      ctx.closePath();
      ctx.fill();
    } else {
      drawShip(ctx, this.x, this.y, this.angle, col, 0.25);
      // Core
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.x - Math.cos(this.angle) * 2, this.y - Math.sin(this.angle) * 2, 3, 0, TAU); ctx.fill();
    }

    // Dash cooldown arc
    if (this.dashCdT > 0) {
      const k = 1 - this.dashCdT / this.s.dashCd;
      ctx.strokeStyle = COL.player;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.stroke();
    } else if (this.readyFlash > 0) {
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = this.readyFlash / 0.25;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, 26 + (1 - this.readyFlash / 0.25) * 10, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

// --- Player bullets --------------------------------------------------------
function drawBullets(ctx, bullets) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of bullets) {
    const col = b.crit ? COL.crit : COL.bullet;
    const tr = b.trail;
    const w = Math.min(b.r, 5.5); // visual cap: huge Heavy Rounds hitboxes shouldn't smear the screen
    // Faint wide trail through history points, then a bright core.
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = w * 2.2;
    ctx.beginPath();
    ctx.moveTo(tr[0], tr[1]);
    for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = w * 0.9;
    ctx.beginPath();
    const h = Math.max(0, tr.length - 4);
    ctx.moveTo(tr[h], tr[h + 1]);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, w * 0.8, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// --- Enemy bullets ---------------------------------------------------------
function drawEnemyBullets(ctx, list, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of list) {
    const pulse = 1 + Math.sin(t * 20 + b.x * 0.05) * 0.15;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2 * pulse, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// --- XP orbs ---------------------------------------------------------------
function drawOrbs(ctx, orbs, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const o of orbs) {
    const big = o.v >= 5;
    const col = big ? COL.xpBig : COL.xp;
    const s = o.r * (1 + Math.sin(t * 8 + o.seed) * 0.15);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(o.x, o.y, s * 2.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(t * 2 + o.seed);
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
