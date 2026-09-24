'use strict';
// ---------------------------------------------------------------------------
// Visual effects: pooled particles, floating damage text, shockwave rings,
// lightning bolts, a spring-mass warping background grid, and screen shake.
// All world-space effects are drawn with additive blending ('lighter').
// ---------------------------------------------------------------------------

const PK_DOT = 0, PK_SPARK = 1, PK_GHOST = 2, PK_SQUARE = 3;

const FX = {
  parts: [],
  pool: [],
  MAX_PARTS: 2600,
  texts: [],
  rings: [],
  bolts: [],
  flashA: 0,
  flashColor: '#fff',

  reset() {
    for (const p of this.parts) this.pool.push(p);
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.bolts.length = 0;
    this.flashA = 0;
  },

  spawn(x, y, vx, vy, life, size, color, kind = PK_DOT, drag = 3) {
    if (this.parts.length >= this.MAX_PARTS) return null;
    const p = this.pool.pop() || {};
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.size = size; p.color = color;
    p.kind = kind; p.drag = drag; p.angle = 0; p.spin = 0; p.grow = 0;
    this.parts.push(p);
    return p;
  },

  burst(x, y, color, n, speed, life = 0.5, size = 2, kind = PK_SPARK) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * rand(0.25, 1);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.2), size * rand(0.7, 1.3), color, kind, 2.5);
    }
  },

  // Directional cone of sparks (muzzle flash, impact spray).
  cone(x, y, angle, spread, color, n, speed, life = 0.25, size = 1.5) {
    for (let i = 0; i < n; i++) {
      const a = angle + rand(-spread, spread), s = speed * rand(0.4, 1);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.1), size, color, PK_SPARK, 5);
    }
  },

  // Big death explosion: sparks + debris squares + glow puff + ring.
  explode(x, y, color, scale = 1) {
    const n = Math.round(18 * scale);
    this.burst(x, y, color, n, 420 * Math.sqrt(scale), 0.55, 2.2);
    this.burst(x, y, '#ffffff', Math.round(n * 0.3), 300 * Math.sqrt(scale), 0.3, 1.6);
    for (let i = 0; i < Math.round(6 * scale); i++) {
      const a = Math.random() * TAU, s = rand(60, 220) * Math.sqrt(scale);
      const p = this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1.0), rand(3, 6) * Math.min(scale, 2), color, PK_SQUARE, 2);
      if (p) { p.angle = Math.random() * TAU; p.spin = rand(-10, 10); }
    }
    const g = this.spawn(x, y, 0, 0, 0.22, 16 * scale, color, PK_DOT, 0);
    if (g) g.grow = 120 * scale;
    this.ring(x, y, 60 * scale, color, 0.35, 3);
  },

  ring(x, y, maxR, color, life = 0.4, width = 3) {
    this.rings.push({ x, y, r: 0, maxR, color, life, max: life, width });
  },

  text(x, y, str, color = '#fff', size = 14, opts = {}) {
    if (this.texts.length > 140) this.texts.shift();
    this.texts.push({
      x: x + rand(-6, 6), y, str, color, size,
      vy: opts.vy !== undefined ? opts.vy : -60,
      life: opts.life || 0.7, max: opts.life || 0.7,
      bold: !!opts.bold,
    });
  },

  bolt(x1, y1, x2, y2, color = '#9ff') {
    const pts = [x1, y1];
    const segs = Math.max(3, Math.floor(dist(x1, y1, x2, y2) / 18));
    const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < segs; i++) {
      const t = i / segs, off = rand(-14, 14);
      pts.push(lerp(x1, x2, t) + nx / nl * off, lerp(y1, y2, t) + ny / nl * off);
    }
    pts.push(x2, y2);
    this.bolts.push({ pts, color, life: 0.16, max: 0.16 });
  },

  flash(alpha, color = '#fff') {
    this.flashA = Math.max(this.flashA, alpha);
    this.flashColor = color;
  },

  update(dt) {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts[i] = parts[parts.length - 1]; parts.pop(); this.pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.grow) p.size += p.grow * dt;
    }
    for (const t of this.texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-3 * dt); }
    compact(this.texts, t => t.life <= 0);
    for (const r of this.rings) { r.life -= dt; r.r = r.maxR * Ease.outCubic(1 - r.life / r.max); }
    compact(this.rings, r => r.life <= 0);
    for (const b of this.bolts) b.life -= dt;
    compact(this.bolts, b => b.life <= 0);
    this.flashA = Math.max(0, this.flashA - dt * 3);
  },

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      const k = p.life / p.max;
      ctx.globalAlpha = k;
      if (p.kind === PK_SPARK) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * (0.5 + k * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === PK_DOT) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = k * (p.grow ? 0.35 : 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (p.grow ? 1 : k)), 0, TAU);
        ctx.fill();
      } else if (p.kind === PK_SQUARE) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        const s = p.size;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else if (p.kind === PK_GHOST) {
        ctx.globalAlpha = k * 0.5;
        drawShip(ctx, p.x, p.y, p.angle, p.color, 1);
      }
    }
    for (const r of this.rings) {
      const k = r.life / r.max;
      ctx.globalAlpha = k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (0.4 + k);
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, r.r), 0, TAU); ctx.stroke();
    }
    for (const b of this.bolts) {
      const k = b.life / b.max;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass ? k : k * 0.5;
        ctx.strokeStyle = pass ? '#ffffff' : b.color;
        ctx.lineWidth = pass ? 1.5 : 5;
        ctx.beginPath();
        ctx.moveTo(b.pts[0], b.pts[1]);
        for (let i = 2; i < b.pts.length; i += 2) ctx.lineTo(b.pts[i], b.pts[i + 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const age = t.max - t.life;
      const pop = age < 0.12 ? Ease.outBack(age / 0.12) : 1;
      const k = clamp(t.life / (t.max * 0.4), 0, 1);
      const size = t.size * (0.4 + 0.6 * pop) * (age < 0.12 ? 1.25 : 1);
      ctx.globalAlpha = k;
      ctx.font = `${t.bold ? 900 : 700} ${size | 0}px ${FONT}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  },
};

// ---------------------------------------------------------------------------
// Warping background grid (spring-mass lattice). Explosions push it, the
// player's wake ripples it, the boss pulls it inward.
// ---------------------------------------------------------------------------
class WarpGrid {
  constructor(w, h, spacing) {
    this.sp = spacing;
    this.cols = Math.floor(w / spacing) + 1;
    this.rows = Math.floor(h / spacing) + 1;
    const n = this.cols * this.rows;
    this.dx = new Float32Array(n); this.dy = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
  }
  reset() { this.dx.fill(0); this.dy.fill(0); this.vx.fill(0); this.vy.fill(0); }

  // strength > 0 pushes outward, < 0 pulls inward. Applied as a velocity impulse.
  force(x, y, strength, radius) {
    const sp = this.sp;
    const c0 = clamp(Math.floor((x - radius) / sp), 1, this.cols - 2), c1 = clamp(Math.ceil((x + radius) / sp), 1, this.cols - 2);
    const r0 = clamp(Math.floor((y - radius) / sp), 1, this.rows - 2), r1 = clamp(Math.ceil((y + radius) / sp), 1, this.rows - 2);
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const px = c * sp + this.dx[i] - x, py = r * sp + this.dy[i] - y;
        const d2 = px * px + py * py;
        if (d2 > r2 || d2 < 1) continue;
        const d = Math.sqrt(d2), f = strength * (1 - d / radius);
        this.vx[i] += px / d * f; this.vy[i] += py / d * f;
      }
  }

  update(dt) {
    const { cols, rows, dx, dy, vx, vy } = this;
    const K = 55, C = 45, D = Math.exp(-5 * dt);
    for (let r = 1; r < rows - 1; r++)
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        const ax = (dx[i - 1] + dx[i + 1] + dx[i - cols] + dx[i + cols]) * 0.25 - dx[i];
        const ay = (dy[i - 1] + dy[i + 1] + dy[i - cols] + dy[i + cols]) * 0.25 - dy[i];
        vx[i] = (vx[i] + (ax * C - dx[i] * K) * dt) * D;
        vy[i] = (vy[i] + (ay * C - dy[i] * K) * dt) * D;
      }
    for (let i = 0; i < dx.length; i++) {
      dx[i] = clamp(dx[i] + vx[i] * dt, -40, 40);
      dy[i] = clamp(dy[i] + vy[i] * dt, -40, 40);
    }
  }

  draw(ctx, view, color) {
    const { cols, rows, dx, dy, sp } = this;
    const c0 = clamp(Math.floor(view.x0 / sp) - 1, 0, cols - 1), c1 = clamp(Math.ceil(view.x1 / sp) + 1, 0, cols - 1);
    const r0 = clamp(Math.floor(view.y0 / sp) - 1, 0, rows - 1), r1 = clamp(Math.ceil(view.y1 / sp) + 1, 0, rows - 1);
    for (let pass = 0; pass < 2; pass++) {
      const major = pass === 1;
      ctx.strokeStyle = color;
      ctx.globalAlpha = major ? 0.32 : 0.12;
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) {
        if ((r % 4 === 0) !== major) continue;
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c, x = c * sp + dx[i], y = r * sp + dy[i];
          c === c0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      for (let c = c0; c <= c1; c++) {
        if ((c % 4 === 0) !== major) continue;
        for (let r = r0; r <= r1; r++) {
          const i = r * cols + c, x = c * sp + dx[i], y = r * sp + dy[i];
          r === r0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// Trauma-based screen shake (Squirrel Eiserloh's GDC talk): offset ∝ trauma².
const Shake = {
  trauma: 0, t: 0, kx: 0, ky: 0,
  add(a) { this.trauma = Math.min(1, this.trauma + a); },
  kick(x, y) { this.kx += x; this.ky += y; },
  reset() { this.trauma = 0; this.kx = 0; this.ky = 0; },
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const d = Math.exp(-18 * dt);
    this.kx *= d; this.ky *= d;
  },
  offset() {
    const s = this.trauma * this.trauma * 22, t = this.t;
    return {
      x: s * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 97.7) * 0.4) + this.kx,
      y: s * (Math.sin(t * 73.1 + 1.3) * 0.6 + Math.sin(t * 89.9 + 2.1) * 0.4) + this.ky,
      rot: this.trauma * this.trauma * 0.02 * Math.sin(t * 41.1),
    };
  },
};
