'use strict';
// ---------------------------------------------------------------------------
// Upgrades. Each one mutates player stats and stacks up to `max` levels.
// Many interact: pierce/ricochet/spread feed chain lightning and volatile
// rounds; phase drive + vampiric turns the dash into a weapon; orbitals
// block bullets, and so on.
// ---------------------------------------------------------------------------

const RARITY = {
  common: { label: 'COMMON', color: '#4df3ff', w: 10, bossW: 3 },
  rare: { label: 'RARE', color: '#c07bff', w: 6, bossW: 6 },
  epic: { label: 'EPIC', color: '#ffd24d', w: 2.5, bossW: 8 },
};

// Tiny vector icons drawn in a [-1,1] box scaled by `s`.
const Icons = {
  rapid(c, s) { for (let i = -1; i <= 1; i++) { c.moveTo((i * 0.5 - 0.2) * s, -0.5 * s); c.lineTo((i * 0.5 + 0.2) * s, 0); c.lineTo((i * 0.5 - 0.2) * s, 0.5 * s); } },
  heavy(c, s) { c.moveTo(0.6 * s, 0); c.arc(0, 0, 0.6 * s, 0, TAU); c.moveTo(0.25 * s, 0); c.arc(0, 0, 0.25 * s, 0, TAU); },
  pierce(c, s) { c.moveTo(-0.8 * s, 0); c.lineTo(0.8 * s, 0); c.moveTo(0.45 * s, -0.3 * s); c.lineTo(0.8 * s, 0); c.lineTo(0.45 * s, 0.3 * s); c.moveTo(-0.1 * s, -0.7 * s); c.lineTo(-0.1 * s, 0.7 * s); c.moveTo(0.25 * s, -0.7 * s); c.lineTo(0.25 * s, -0.2 * s); c.moveTo(0.25 * s, 0.2 * s); c.lineTo(0.25 * s, 0.7 * s); },
  spread(c, s) { for (const a of [-0.5, 0, 0.5]) { c.moveTo(-0.7 * s, 0.4 * s); c.lineTo((-0.7 + Math.cos(a - 0.3) * 1.5) * s, (0.4 + Math.sin(a - 0.3) * 1.5) * s * 0.8); } },
  orbit(c, s) { c.moveTo(0.2 * s, 0); c.arc(0, 0, 0.2 * s, 0, TAU); c.moveTo(0.7 * s, 0); c.arc(0, 0, 0.7 * s, 0, TAU); c.moveTo(-0.5 * s, -0.5 * s); c.arc(-0.5 * s, -0.5 * s, 0.15 * s, 0, TAU); },
  chain(c, s) { c.moveTo(0.2 * s, -0.9 * s); c.lineTo(-0.35 * s, 0.05 * s); c.lineTo(0.15 * s, 0.05 * s); c.lineTo(-0.2 * s, 0.9 * s); },
  vamp(c, s) { c.moveTo(0, -0.8 * s); c.bezierCurveTo(0.7 * s, 0, 0.6 * s, 0.7 * s, 0, 0.7 * s); c.bezierCurveTo(-0.6 * s, 0.7 * s, -0.7 * s, 0, 0, -0.8 * s); },
  dash(c, s) { c.moveTo(-0.1 * s, -0.6 * s); c.lineTo(0.5 * s, 0); c.lineTo(-0.1 * s, 0.6 * s); c.moveTo(-0.8 * s, -0.3 * s); c.lineTo(-0.3 * s, -0.3 * s); c.moveTo(-0.9 * s, 0); c.lineTo(-0.2 * s, 0); c.moveTo(-0.8 * s, 0.3 * s); c.lineTo(-0.3 * s, 0.3 * s); },
  magnet(c, s) { c.moveTo(-0.6 * s, -0.7 * s); c.lineTo(-0.6 * s, 0.1 * s); c.arc(0, 0.1 * s, 0.6 * s, Math.PI, 0, true); c.lineTo(0.6 * s, -0.7 * s); c.moveTo(-0.25 * s, -0.7 * s); c.lineTo(-0.25 * s, 0.1 * s); c.arc(0, 0.1 * s, 0.25 * s, Math.PI, 0, true); c.lineTo(0.25 * s, -0.7 * s); },
  explosive(c, s) { for (let i = 0; i < 8; i++) { const a = i * TAU / 8, r = i % 2 ? 0.45 : 0.9; i ? c.lineTo(Math.cos(a) * r * s, Math.sin(a) * r * s) : c.moveTo(Math.cos(a) * r * s, Math.sin(a) * r * s); } c.closePath(); },
  ricochet(c, s) { c.moveTo(-0.8 * s, -0.6 * s); c.lineTo(0.1 * s, 0.6 * s); c.lineTo(0.8 * s, -0.4 * s); c.moveTo(-0.9 * s, 0.75 * s); c.lineTo(0.9 * s, 0.75 * s); },
  homing(c, s) { c.moveTo(-0.8 * s, 0.6 * s); c.quadraticCurveTo(-0.6 * s, -0.6 * s, 0.6 * s, -0.4 * s); c.moveTo(0.3 * s, -0.7 * s); c.lineTo(0.6 * s, -0.4 * s); c.lineTo(0.3 * s, -0.1 * s); c.moveTo(0.85 * s, 0.4 * s); c.arc(0.7 * s, 0.4 * s, 0.15 * s, 0, TAU); },
  crit(c, s) { c.moveTo(0.55 * s, 0); c.arc(0, 0, 0.55 * s, 0, TAU); for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(x * 0.3 * s, y * 0.3 * s); c.lineTo(x * 0.9 * s, y * 0.9 * s); } },
  speed(c, s) { c.moveTo(-0.7 * s, 0.5 * s); c.lineTo(0.7 * s, -0.5 * s); c.moveTo(0.1 * s, -0.5 * s); c.lineTo(0.7 * s, -0.5 * s); c.lineTo(0.7 * s, 0.1 * s); c.moveTo(-0.7 * s, -0.1 * s); c.lineTo(-0.2 * s, -0.45 * s); c.moveTo(-0.2 * s, 0.6 * s); c.lineTo(0.3 * s, 0.25 * s); },
  vital(c, s) { c.moveTo(-0.25 * s, -0.8 * s); c.lineTo(0.25 * s, -0.8 * s); c.lineTo(0.25 * s, -0.25 * s); c.lineTo(0.8 * s, -0.25 * s); c.lineTo(0.8 * s, 0.25 * s); c.lineTo(0.25 * s, 0.25 * s); c.lineTo(0.25 * s, 0.8 * s); c.lineTo(-0.25 * s, 0.8 * s); c.lineTo(-0.25 * s, 0.25 * s); c.lineTo(-0.8 * s, 0.25 * s); c.lineTo(-0.8 * s, -0.25 * s); c.lineTo(-0.25 * s, -0.25 * s); c.closePath(); },
  rear(c, s) { c.moveTo(0.9 * s, 0); c.lineTo(0.4 * s, -0.4 * s); c.moveTo(0.9 * s, 0); c.lineTo(0.4 * s, 0.4 * s); c.moveTo(-0.9 * s, 0); c.lineTo(-0.4 * s, -0.4 * s); c.moveTo(-0.9 * s, 0); c.lineTo(-0.4 * s, 0.4 * s); c.moveTo(-0.9 * s, 0); c.lineTo(0.9 * s, 0); },
  nova(c, s) { for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.moveTo(Math.cos(a) * 0.35 * s, Math.sin(a) * 0.35 * s); c.lineTo(Math.cos(a) * 0.9 * s, Math.sin(a) * 0.9 * s); } },
  regen(c, s) { c.moveTo(0.75 * s, 0); c.arc(0, 0, 0.75 * s, 0, TAU * 0.8); c.moveTo(-0.3 * s, 0); c.lineTo(0.3 * s, 0); c.moveTo(0, -0.3 * s); c.lineTo(0, 0.3 * s); },
  repair(c, s) { Icons.vital(c, s * 0.8); },
  bounty(c, s) { c.moveTo(0, -0.8 * s); c.lineTo(0.8 * s, 0); c.lineTo(0, 0.8 * s); c.lineTo(-0.8 * s, 0); c.closePath(); c.moveTo(0, -0.35 * s); c.lineTo(0.35 * s, 0); c.lineTo(0, 0.35 * s); c.lineTo(-0.35 * s, 0); c.closePath(); },
};

function drawIcon(ctx, id, x, y, s, color, lw = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  (Icons[id] || Icons.bounty)(ctx, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

const UPGRADES = [
  { id: 'rapid', name: 'Rapid Fire', rarity: 'common', max: 8, desc: '+18% fire rate.',
    apply: p => { p.s.fireRate *= 1.18; } },
  { id: 'heavy', name: 'Heavy Rounds', rarity: 'common', max: 6, desc: '+25% damage and bigger bullets.',
    apply: p => { p.s.damage *= 1.25; p.s.bulletSize += 0.8; } },
  { id: 'crit', name: 'Overclock', rarity: 'common', max: 5, desc: '+10% critical chance. Crits deal 2.5x (+0.25x per level).',
    apply: p => { p.s.crit += 0.1; p.s.critMult += 0.25; } },
  { id: 'speed', name: 'Thrusters', rarity: 'common', max: 4, desc: '+12% move speed.',
    apply: p => { p.s.speed *= 1.12; } },
  { id: 'vital', name: 'Hull Plating', rarity: 'common', max: 5, desc: '+25 max HP and fully repair the hull.',
    apply: p => { p.maxHp += 25; p.hp = p.maxHp; } },
  { id: 'magnet', name: 'Tractor Field', rarity: 'common', max: 4, desc: '+60% pickup radius and +15% XP gained.',
    apply: p => { p.s.magnet *= 1.6; p.s.xpMult += 0.15; } },
  { id: 'dash', name: 'Phase Drive', rarity: 'common', max: 4, desc: 'Dash +30% farther, -15% cooldown, and shreds enemies you pass through.',
    apply: p => { p.s.dashDist *= 1.3; p.s.dashCd *= 0.85; p.s.dashDamage += 30; } },
  { id: 'rear', name: 'Rear Guard', rarity: 'common', max: 2, desc: 'Adds a backward-firing cannon.',
    apply: p => { p.s.rear += 1; } },
  { id: 'pierce', name: 'Piercing Rounds', rarity: 'rare', max: 5, desc: 'Bullets pierce +1 enemy.',
    apply: p => { p.s.pierce += 1; } },
  { id: 'spread', name: 'Spread Shot', rarity: 'rare', max: 5, desc: '+1 projectile per shot (-5% fire rate).',
    apply: p => { p.s.projectiles += 1; p.s.fireRate *= 0.95; } },
  { id: 'orbit', name: 'Orbital Blades', rarity: 'rare', max: 6, desc: '+1 orbiting blade that cuts enemies and eats bullets.',
    apply: p => { p.s.orbitals += 1; } },
  { id: 'chain', name: 'Chain Lightning', rarity: 'rare', max: 5, desc: '+15% chance on hit to arc lightning to nearby enemies (+1 jump).',
    apply: p => { p.s.chain += 0.15; p.s.chainJumps += 1; } },
  { id: 'vamp', name: 'Vampiric Core', rarity: 'rare', max: 5, desc: 'Heal 1.5 HP for every kill.',
    apply: p => { p.s.lifesteal += 1.5; } },
  { id: 'ricochet', name: 'Ricochet', rarity: 'rare', max: 4, desc: 'Bullets bounce off walls and redirect to a new target +1 time.',
    apply: p => { p.s.bounce += 1; } },
  { id: 'homing', name: 'Seeker Chips', rarity: 'rare', max: 3, desc: 'Bullets curve toward nearby enemies.',
    apply: p => { p.s.homing += 1; } },
  { id: 'regen', name: 'Nanobots', rarity: 'rare', max: 3, desc: 'Regenerate 1 HP per second.',
    apply: p => { p.s.regen += 1; } },
  { id: 'explosive', name: 'Volatile Rounds', rarity: 'epic', max: 4, desc: 'Kills detonate, damaging nearby enemies. Explosions can chain.',
    apply: p => { p.s.explosive += 1; } },
  { id: 'nova', name: 'Dash Nova', rarity: 'epic', max: 3, desc: 'Ending a dash fires a ring of 8 bullets (+4 per level).',
    apply: p => { p.s.nova += 1; } },
];

// Fallbacks for when every upgrade is maxed.
const FILLERS = [
  { id: 'repair', name: 'Field Repair', rarity: 'common', max: 99, desc: 'Restore 60% of your hull.', filler: true,
    apply: p => { p.heal(p.maxHp * 0.6); } },
  { id: 'bounty', name: 'Bounty', rarity: 'common', max: 99, desc: '+10,000 score.', filler: true,
    apply: (p, g) => { g.score += 10000; } },
];

function rollUpgrades(player, n, bossReward) {
  const pool = UPGRADES.filter(u => (player.upgrades[u.id] || 0) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const weights = pool.map(u => bossReward ? RARITY[u.rarity].bossW : RARITY[u.rarity].w);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r > weights[i]) { r -= weights[i]; i++; }
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  for (let i = 0; out.length < n; i++) out.push(FILLERS[i % FILLERS.length]);
  return out;
}

function applyUpgrade(u, player, g) {
  u.apply(player, g);
  if (u.filler) return;
  if (!player.upgrades[u.id]) player.upgradeOrder.push(u.id);
  player.upgrades[u.id] = (player.upgrades[u.id] || 0) + 1;
}
