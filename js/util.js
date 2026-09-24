'use strict';
// ---------------------------------------------------------------------------
// Math / helpers shared by every other file (classic scripts share globals).
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const FONT = "'Orbitron', 'Segoe UI', system-ui, sans-serif";

function rand(a = 1, b) {
  return b === undefined ? Math.random() * a : a + Math.random() * (b - a);
}
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function randSign() { return Math.random() < 0.5 ? -1 : 1; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
// Frame-rate independent exponential smoothing factor.
function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const Ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
};

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function formatNum(n) { return Math.floor(n).toLocaleString('en-US'); }

// localStorage can throw (private mode, file:// in some browsers) — never let it crash the game.
const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('neonrift.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('neonrift.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  },
};

// Uniform grid broadphase. Entities are inserted into every cell their radius
// overlaps; queries dedupe with a stamp so each entity is returned once.
class SpatialGrid {
  constructor(width, height, cell) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.stamp = 0;
    this.out = [];
  }
  clear() { for (const c of this.cells) c.length = 0; }
  insert(e) {
    const cs = this.cell;
    const x0 = clamp(Math.floor((e.x - e.r) / cs), 0, this.cols - 1);
    const x1 = clamp(Math.floor((e.x + e.r) / cs), 0, this.cols - 1);
    const y0 = clamp(Math.floor((e.y - e.r) / cs), 0, this.rows - 1);
    const y1 = clamp(Math.floor((e.y + e.r) / cs), 0, this.rows - 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) this.cells[y * this.cols + x].push(e);
  }
  // Pass your own `out` array if you might run another query while iterating.
  query(px, py, r, out = this.out) {
    out.length = 0;
    const s = ++this.stamp, cs = this.cell;
    const x0 = clamp(Math.floor((px - r) / cs), 0, this.cols - 1);
    const x1 = clamp(Math.floor((px + r) / cs), 0, this.cols - 1);
    const y0 = clamp(Math.floor((py - r) / cs), 0, this.rows - 1);
    const y1 = clamp(Math.floor((py + r) / cs), 0, this.rows - 1);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cell = this.cells[y * this.cols + x];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (e._qs !== s) { e._qs = s; out.push(e); }
        }
      }
    return out;
  }
}

// Remove dead items in place without allocating (stable, O(n)).
function compact(arr, isDead) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (!isDead(arr[i])) arr[w++] = arr[i];
  arr.length = w;
}
