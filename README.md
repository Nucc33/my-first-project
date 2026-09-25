# NEON RIFT

A top-down neon arena survival shooter in the spirit of *Geometry Wars* meets *Vampire Survivors*.
Pilot a glowing ship through escalating waves, build a ridiculous weapon loadout one upgrade
at a time, and chase the high score.

Pure HTML5 Canvas + vanilla JavaScript. No frameworks, no build step, no asset files.
Every sound, including the music, is synthesized live with the Web Audio API.

## Run it

**Option A:** open `index.html` directly in a modern browser (Chrome, Firefox, Edge, Safari).

**Option B:** serve the folder:

```sh
npx serve .
# then open the printed URL (usually http://localhost:3000)
```

Sound starts on your first click or key press (a browser autoplay rule).

## Controls

| Input              | Action                                   |
| ------------------ | ---------------------------------------- |
| `W` `A` `S` `D`    | Move (arrow keys also work)              |
| Mouse              | Aim                                      |
| Hold left click    | Fire                                     |
| `Space`            | Dash: brief invincibility, short cooldown |
| `P` / `Esc`        | Pause                                    |
| `1` `2` `3` / click | Pick an upgrade card                    |
| `M`                | Mute / unmute all sound                  |
| `N`                | Toggle music                             |
| `R`                | Restart (game over or pause screen)      |

## Put your friends in the game

On the title screen press **C** (or click **ADD YOUR FRIENDS**) to open the Characters screen.
Click a slot and pick a photo to cast someone as the **hero** (you), **the boss**, or one of
the enemy types. Their face replaces that character's neon shape. Click **×** on a slot to go back
to the default look. When you lose, the game over screen shows who took you out.

Photos are cropped to a small square and saved only in your browser on this computer. They are
never uploaded and are not part of the project files. JPG and PNG work everywhere; iPhone HEIC photos may
only load in Safari.

## How to play

- Clear a wave and you choose **1 of 3 upgrades**. Boss waves offer better (rarer) cards.
- Enemies drop **XP orbs** that get pulled toward you once you're close. Filling the XP bar
  levels you up and releases a **nova** that damages nearby enemies, erases bullets and repairs your hull.
- Kills build a **combo**. Every 10 kills raises your score multiplier (up to x20).
  Getting hit **resets the combo**. Stop killing for a few seconds and it decays one tier at a time.
- A **boss** arrives every 5 waves, and it gets tougher each time.
- Your high score and best wave are saved in `localStorage`.

### Enemies

| Enemy       | Behavior                                                            |
| ----------- | ------------------------------------------------------------------- |
| Chaser  ◆   | Homes in on you relentlessly.                                       |
| Swarmer ▲   | Fast, fragile, arrives in weaving packs.                            |
| Tank ⬢      | Slow and tough. Bursts into three fast shards when destroyed.        |
| Shooter ■   | Keeps its distance, charges (the core glows), then fires.            |
| Dasher ➤    | Shows a dashed line, locks on, then lunges along it.                 |
| The Warden  | Boss with three phases: bullet spirals, ring bursts, aimed fans, summons and wall-slamming charges. |

### Upgrades (18)

Rapid Fire, Heavy Rounds, Overclock (crits), Thrusters, Hull Plating, Tractor Field (magnet),
Phase Drive (dash that damages), Rear Guard, Piercing Rounds, Spread Shot, Orbital Blades,
Chain Lightning, Vampiric Core, Ricochet, Seeker Chips (homing), Nanobots (regen),
Volatile Rounds (chain-reacting explosions) and Dash Nova.

They stack: Spread + Pierce + Chain Lightning turns every volley into a light show,
Volatile Rounds sets off chain reactions through dense packs, and Phase Drive + Dash Nova +
Vampiric Core turns the dash into your main weapon.

**Practice:** open `index.html?wave=8` to start at wave 8 with a random 7-upgrade build.

## Code tour

```
index.html        canvas + script tags (classic scripts, so file:// works)
style.css
js/util.js        math/easing helpers, safe localStorage, uniform-grid broadphase
js/input.js       keyboard/mouse state with per-tick edge detection
js/audio.js       Web Audio synth: SFX + look-ahead step-sequencer music
js/faces.js       Characters screen: photo faces stored in localStorage
js/fx.js          pooled particles, damage numbers, rings, lightning, warp grid, screen shake
js/entities.js    player ship, bullets, enemy bullets, XP orbs
js/enemies.js     enemy types + the Warden boss
js/upgrades.js    upgrade definitions, rarity rolls, vector icons
js/waves.js       wave director: threat budget, unlocks, spawn cadence
js/ui.js          title, HUD, banners, upgrade cards, pause, game over
js/game.js        state machine, fixed 60 Hz timestep, collisions, render + bloom pipeline
```

- **Loop:** fixed 1/60 s simulation steps with an accumulator (at most 5 catch-up steps),
  plus hit-stop (frozen frames) and slow-motion on top.
- **Bloom:** the scene renders to an offscreen canvas. Three successive half-size copies are then
  added back on top (`lighter` blend), which gives a cheap glow without per-shape `shadowBlur`.
- **Collisions:** enemies go into a uniform spatial grid every tick. Bullets, orbitals, dash,
  explosions, chain lightning and separation all query it.
