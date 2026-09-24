'use strict';
// ---------------------------------------------------------------------------
// Wave director. Each wave gets a "threat budget" that grows ~quadratically;
// enemy types unlock over the first waves and are bought from the budget.
// Spawn cadence and group size also ramp, so wave 1-2 (the first minute) is
// gentle and wave 10 is a screen full of mixed threats.
// ---------------------------------------------------------------------------

const SPAWN_TABLE = [
  { type: 'chaser', cost: 1, unlock: 1, weight: w => Math.max(3, 12 - w) },
  { type: 'swarm', cost: 4, unlock: 2, weight: w => 4 + w * 0.3 },
  { type: 'shooter', cost: 3, unlock: 3, weight: w => 3 + w * 0.25 },
  { type: 'tank', cost: 6, unlock: 4, weight: w => 2 + w * 0.2 },
  { type: 'dasher', cost: 4, unlock: 6, weight: w => 3 + w * 0.2 },
];

const MAX_ENEMIES = 160;

class Director {
  constructor(game) {
    this.g = game;
    this.wave = 0;
    this.queue = [];
    this.scale = { hp: 1, spd: 1, dmg: 1 };
  }

  static scaleFor(n) {
    const w = n - 1;
    return {
      hp: 1 + 0.12 * w + 0.006 * w * w,
      spd: 1 + Math.min(0.35, 0.03 * w),
      dmg: 1 + 0.05 * w,
    };
  }

  begin(n) {
    this.wave = n;
    this.scale = Director.scaleFor(n);
    this.isBoss = n % 5 === 0;
    this.bossTier = n / 5;
    this.boss = null;
    this.bossSpawned = false;

    let budget = Math.round(14 + n * 8 + n * n * 0.9);
    if (this.isBoss) budget = Math.round(budget * 0.3);
    const table = SPAWN_TABLE.filter(e => e.unlock <= n);
    this.queue = [];
    // Guarantee newly unlocked types appear in their debut wave.
    for (const e of table) if (e.unlock === n && budget >= e.cost) { this.queue.push(e.type); budget -= e.cost; }
    while (budget > 0) {
      const opts = table.filter(e => e.cost <= budget);
      if (!opts.length) break;
      const ws = opts.map(e => e.weight(n));
      let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
      while (r > ws[i]) { r -= ws[i]; i++; }
      const e = opts[Math.min(i, opts.length - 1)];
      this.queue.push(e.type);
      budget -= e.cost;
    }
    shuffle(this.queue);
    this.total = this.queue.length;
    this.interval = Math.max(0.55, 1.5 - 0.08 * (n - 1));
    this.groupSize = 1 + Math.floor((n + 2) / 3);
    this.timer = 2.2; // grace period while the WAVE banner plays
  }

  // Enemies still to come (a queued swarm counts as its whole pack).
  get remaining() {
    const pack = 5 + Math.floor(this.wave / 3);
    return this.queue.reduce((n, t) => n + (t === 'swarm' ? pack : 1), 0);
  }

  // Returns a spawn point inside the arena, away from (and ideally off-screen from) the player.
  spawnPoint(minD = 430, maxD = 820) {
    const p = this.g.player;
    for (let i = 0; i < 30; i++) {
      const a = rand(TAU), d = rand(minD, maxD);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x > 40 && x < ARENA_W - 40 && y > 40 && y < ARENA_H - 40) return { x, y };
    }
    // Fallback: the arena corner farthest from the player.
    return { x: p.x < ARENA_W / 2 ? ARENA_W - 80 : 80, y: p.y < ARENA_H / 2 ? ARENA_H - 80 : 80 };
  }

  spawn(type, x, y) {
    const g = this.g, sc = this.scale;
    switch (type) {
      case 'chaser': g.enemies.push(new Chaser(x, y, sc)); break;
      case 'shooter': g.enemies.push(new Shooter(x, y, sc, this.wave)); break;
      case 'tank': g.enemies.push(new Tank(x, y, sc)); break;
      case 'dasher': g.enemies.push(new Dasher(x, y, sc)); break;
      case 'swarm': {
        const n = 5 + Math.floor(this.wave / 3); // keep in sync with `remaining`
        for (let i = 0; i < n; i++) {
          const a = rand(TAU), d = rand(10, 45);
          g.enemies.push(new Swarmer(clamp(x + Math.cos(a) * d, 20, ARENA_W - 20), clamp(y + Math.sin(a) * d, 20, ARENA_H - 20), sc));
        }
        break;
      }
    }
  }

  update(dt) {
    const g = this.g;
    this.timer -= dt;
    if (this.isBoss && !this.bossSpawned && this.timer <= 0.6) {
      this.bossSpawned = true;
      const pt = this.spawnPoint(380, 520);
      this.boss = new Boss(pt.x, pt.y, this.scale, this.bossTier);
      g.enemies.push(this.boss);
      g.onBossSpawn(this.boss);
    }
    if (this.timer > 0 || !this.queue.length) return;
    if (g.enemies.length >= MAX_ENEMIES) { this.timer = 0.3; return; }

    const pt = this.spawnPoint();
    for (let i = 0; i < this.groupSize && this.queue.length; i++) {
      const jx = rand(-60, 60), jy = rand(-60, 60);
      this.spawn(this.queue.pop(), clamp(pt.x + jx, 30, ARENA_W - 30), clamp(pt.y + jy, 30, ARENA_H - 30));
    }
    // Boss waves keep the pressure lower so the boss is the focus.
    const mult = this.isBoss ? 2.2 : 1;
    this.timer = this.interval * rand(0.7, 1.3) * mult;
  }

  done() {
    if (this.queue.length) return false;
    if (this.isBoss && (!this.bossSpawned || !this.boss.dead)) return false;
    return this.g.enemies.length === 0;
  }
}
