'use strict';
// ---------------------------------------------------------------------------
// Screen-space UI: title, HUD, wave banners, upgrade cards, pause, game over.
// Drawn onto the scene canvas before bloom so text and bars get the glow.
// ---------------------------------------------------------------------------

const UI = {
  draw(c, g) {
    c.save();
    c.textBaseline = 'middle';
    switch (g.state) {
      case 'title': this.title(c, g); break;
      case 'faces': this.faces(c, g); break;
      case 'playing': this.hud(c, g); this.bannerDraw(c, g); break;
      case 'upgrade': this.hud(c, g); this.upgrade(c, g); break;
      case 'paused': this.hud(c, g); this.paused(c, g); break;
      case 'dying': c.globalAlpha = Math.max(0, 1 - g.dyingT); this.hud(c, g); break;
      case 'gameover': this.gameOver(c, g); break;
    }
    c.restore();
  },

  // ---------------------------------------------------------------- helpers
  font(size, weight = 700) { return `${weight} ${Math.round(size)}px ${FONT}`; },

  rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  },

  // Letter-spaced text (works without ctx.letterSpacing support).
  spaced(c, str, x, y, spacing, align = 'center') {
    let w = 0;
    const ws = [];
    for (const ch of str) { const cw = c.measureText(ch).width; ws.push(cw); w += cw + spacing; }
    w -= spacing;
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const prev = c.textAlign;
    c.textAlign = 'left';
    let i = 0;
    for (const ch of str) { c.fillText(ch, cx, y); cx += ws[i++] + spacing; }
    c.textAlign = prev;
    return w;
  },

  wrap(c, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  },

  panel(c, x, y, w, h, a = 0.55) {
    c.fillStyle = `rgba(6,10,26,${a})`;
    this.rr(c, x, y, w, h, 8);
    c.fill();
    c.strokeStyle = 'rgba(77,243,255,0.18)';
    c.lineWidth = 1;
    c.stroke();
  },

  // ---------------------------------------------------------------- title
  title(c, g) {
    const W = g.W, H = g.H, t = g.realT;
    const cx = W / 2, cy = H * 0.34;
    const size = Math.min(130, W / 7.5);
    c.font = this.font(size, 900);
    c.textAlign = 'left';
    const word = 'NEON RIFT';
    const spacing = size * 0.08;
    const widths = [...word].map(ch => c.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (word.length - 1);
    const intro = clamp(g.titleT / 1.2, 0, 1);
    const glitch = Math.sin(t * 1.3) * Math.sin(t * 3.7) > 0.93;
    c.globalCompositeOperation = 'lighter';
    let x = cx - total / 2;
    [...word].forEach((ch, i) => {
      const k = clamp(intro * 1.6 - i * 0.07, 0, 1);
      const drop = (1 - Ease.outBack(k)) * -80;
      const y = cy + Math.sin(t * 2.2 + i * 0.55) * 6 + drop;
      const jx = glitch && i % 3 === 1 ? rand(-10, 10) : 0;
      c.globalAlpha = k * 0.7;
      c.fillStyle = '#ff2e9a'; c.fillText(ch, x - 3 + jx, y);
      c.fillStyle = '#2ee6ff'; c.fillText(ch, x + 3 - jx, y);
      c.globalAlpha = k;
      c.fillStyle = '#ffffff'; c.fillText(ch, x, y);
      x += widths[i] + spacing;
    });
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = intro;

    c.fillStyle = '#4df3ff';
    c.font = this.font(Math.max(13, size * 0.15), 700);
    this.spaced(c, 'SURVIVE  THE  GRID', cx, cy + size * 0.72, size * 0.06);

    // Cast row: any photos the player has added.
    const cast = FACE_SLOTS.filter(sl => Faces.get(sl.id));
    if (cast.length) {
      const R = 20, step = 52, x0 = cx - (cast.length - 1) * step / 2, fy = cy + size * 0.72 + 58;
      cast.forEach((sl, i) => {
        const bob = Math.sin(t * 3 + i) * 3;
        drawFace(c, Faces.get(sl.id), x0 + i * step, fy + bob, sl.id === 'player' ? R + 4 : R, sl.color, false);
      });
      c.globalAlpha = intro;
    }

    // Characters button
    const bt = this.titleButton(g), m = Input.mouse;
    const hov = m.x >= bt.x && m.x <= bt.x + bt.w && m.y >= bt.y && m.y <= bt.y + bt.h;
    this.rr(c, bt.x, bt.y, bt.w, bt.h, 8);
    c.fillStyle = hov ? 'rgba(255,225,77,0.18)' : 'rgba(6,10,26,0.7)';
    c.fill();
    c.strokeStyle = hov ? '#ffe14d' : 'rgba(255,225,77,0.5)';
    c.lineWidth = 1.5;
    c.stroke();
    c.font = this.font(14, 800);
    c.fillStyle = '#ffe14d';
    c.textAlign = 'center';
    this.spaced(c, cast.length ? 'EDIT  CHARACTERS  [C]' : 'ADD  YOUR  FRIENDS  [C]', cx, bt.y + bt.h / 2, 2);

    // Pulsing prompt
    c.globalAlpha = intro * (0.55 + 0.45 * Math.sin(t * 4));
    c.fillStyle = '#ffffff';
    c.font = this.font(20, 800);
    this.spaced(c, 'CLICK  OR  PRESS  ENTER', cx, H * 0.58, 3);

    // Controls
    c.globalAlpha = intro * 0.85;
    const rows = [
      ['WASD', 'move'], ['MOUSE', 'aim'], ['HOLD CLICK', 'fire'],
      ['SPACE', 'dash (i-frames)'], ['P / ESC', 'pause'], ['M / N', 'sound / music'],
    ];
    const colW = Math.min(250, W / 3.4), top = H * 0.67;
    rows.forEach(([k, v], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x0 = cx + (col - 1) * colW, y0 = top + row * 30;
      c.font = this.font(13, 800);
      c.fillStyle = '#ffe14d';
      c.textAlign = 'right';
      c.fillText(k, x0 - 6, y0);
      c.font = this.font(13, 500);
      c.fillStyle = '#9fb3d9';
      c.textAlign = 'left';
      c.fillText(v, x0 + 6, y0);
    });

    c.textAlign = 'center';
    c.font = this.font(15, 700);
    c.fillStyle = '#5dffb0';
    const hs = g.highScore > 0 ? `HIGH SCORE  ${formatNum(g.highScore)}   ·   BEST WAVE  ${g.bestWave}` : 'NO HIGH SCORE YET — MAKE ONE';
    c.fillText(hs, cx, H * 0.83);

    c.font = this.font(12, 500);
    c.fillStyle = '#56648a';
    c.fillText(`sound ${Sound.muted ? 'OFF' : 'ON'}  ·  music ${Sound.musicOn ? 'ON' : 'OFF'}`, cx, H - 28);
    c.globalAlpha = 1;
  },

  titleButton(g) {
    const w = 300, h = 40;
    return { x: g.W / 2 - w / 2, y: g.H * 0.765 - h / 2, w, h };
  },

  // ------------------------------------------------------------ characters
  faceRects(g) {
    const W = g.W, H = g.H, n = FACE_SLOTS.length;
    const cols = W >= 1100 ? n : 4, rows = Math.ceil(n / cols), gap = 16;
    const cw = Math.min(160, (W - 60 - (cols - 1) * gap) / cols);
    const ch = Math.min(cw * 1.45, (H - 260) / rows - gap);
    const total = rows * ch + (rows - 1) * gap;
    const y0 = H / 2 - total / 2 + 10;
    return FACE_SLOTS.map((sl, i) => {
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), col = i - row * cols;
      const x0 = W / 2 - (inRow * cw + (inRow - 1) * gap) / 2;
      const x = x0 + col * (cw + gap), y = y0 + row * (ch + gap);
      return { x, y, w: cw, h: ch, id: sl.id, clear: { x: x + cw - 26, y: y + 6, w: 20, h: 20 } };
    });
  },

  facesButtons(g) {
    const w = 170, h = 42, y = g.H - 78;
    return {
      back: { x: g.W / 2 - w - 10, y, w, h },
      play: { x: g.W / 2 + 10, y, w, h },
    };
  },

  facesHit(g, x, y) {
    const inR = r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const b = this.facesButtons(g);
    if (inR(b.back)) return { type: 'back' };
    if (inR(b.play)) return { type: 'play' };
    for (const r of this.faceRects(g)) {
      if (Faces.get(r.id) && inR(r.clear)) return { type: 'clear', id: r.id };
      if (inR(r)) return { type: 'slot', id: r.id };
    }
    return null;
  },

  faces(c, g) {
    const W = g.W, H = g.H, t = g.realT, m = Input.mouse;
    c.fillStyle = 'rgba(2,3,10,0.72)';
    c.fillRect(0, 0, W, H);
    const rects = this.faceRects(g);
    const top = rects[0].y;
    c.textAlign = 'center';
    c.font = this.font(Math.min(42, W / 18), 900);
    c.fillStyle = '#ffe14d';
    this.spaced(c, 'CHARACTERS', W / 2, top - 78, 6);
    c.font = this.font(14, 600);
    c.fillStyle = '#d6e2ff';
    c.fillText('Click a slot and pick a photo. Put a friend in any role: the hero, the boss, or the bad guys.', W / 2, top - 40);
    c.font = this.font(11, 500);
    c.fillStyle = '#56648a';
    c.fillText('Photos stay saved in this browser on this computer. They are never uploaded.', W / 2, top - 20);

    rects.forEach((r, i) => {
      const sl = FACE_SLOTS[i], face = Faces.get(sl.id);
      const hov = m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
      this.rr(c, r.x, r.y, r.w, r.h, 12);
      c.fillStyle = hov ? 'rgba(20,28,60,0.95)' : 'rgba(9,13,32,0.92)';
      c.fill();
      c.strokeStyle = sl.color;
      c.globalAlpha = hov ? 1 : 0.6;
      c.lineWidth = hov ? 2.5 : 1.5;
      c.stroke();
      c.globalAlpha = 1;

      const R = Math.min(r.w * 0.32, r.h * 0.26), fx = r.x + r.w / 2, fy = r.y + r.h * 0.36;
      if (face) {
        drawFace(c, face, fx, fy + Math.sin(t * 3 + i) * 2, R, sl.color, false);
        // Clear button
        const cl = r.clear, ch = m.x >= cl.x && m.x <= cl.x + cl.w && m.y >= cl.y && m.y <= cl.y + cl.h;
        c.strokeStyle = ch ? '#ff2e55' : '#56648a';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(cl.x + 5, cl.y + 5); c.lineTo(cl.x + 15, cl.y + 15);
        c.moveTo(cl.x + 15, cl.y + 5); c.lineTo(cl.x + 5, cl.y + 15);
        c.stroke();
      } else {
        c.strokeStyle = sl.color;
        c.globalAlpha = 0.5 + (hov ? 0.4 : 0.15 * Math.sin(t * 3 + i));
        c.lineWidth = 2;
        c.setLineDash([6, 6]);
        c.beginPath(); c.arc(fx, fy, R, 0, TAU); c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(fx - R * 0.3, fy); c.lineTo(fx + R * 0.3, fy);
        c.moveTo(fx, fy - R * 0.3); c.lineTo(fx, fy + R * 0.3);
        c.stroke();
        c.globalAlpha = 1;
      }
      c.textAlign = 'center';
      c.font = this.font(Math.min(15, r.w / 9), 900);
      c.fillStyle = sl.color;
      c.fillText(sl.name, fx, r.y + r.h * 0.7);
      c.font = this.font(11, 500);
      c.fillStyle = '#9fb3d9';
      c.fillText(sl.role, fx, r.y + r.h * 0.7 + 20);
      c.font = this.font(10, 700);
      c.fillStyle = hov ? '#ffffff' : '#56648a';
      c.fillText(face ? 'click to change' : '+ add photo', fx, r.y + r.h - 14);
    });

    const b = this.facesButtons(g);
    [['back', 'BACK  [ESC]', '#9fb3d9'], ['play', 'PLAY  [ENTER]', '#4df3ff']].forEach(([k, label, col]) => {
      const r = b[k], hov = m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
      this.rr(c, r.x, r.y, r.w, r.h, 8);
      c.fillStyle = hov ? 'rgba(77,243,255,0.15)' : 'rgba(6,10,26,0.8)';
      c.fill();
      c.strokeStyle = col; c.lineWidth = hov ? 2 : 1; c.stroke();
      c.font = this.font(14, 800);
      c.fillStyle = col;
      this.spaced(c, label, r.x + r.w / 2, r.y + r.h / 2, 2);
    });

    if (Faces.msgT > 0) {
      c.globalAlpha = Math.min(1, Faces.msgT);
      c.font = this.font(14, 700);
      c.fillStyle = '#ff5a6e';
      c.fillText(Faces.msg, W / 2, b.back.y - 24);
      c.globalAlpha = 1;
    }
  },

  // ---------------------------------------------------------------- HUD
  hud(c, g) {
    const p = g.player, W = g.W, H = g.H, u = g.ui, t = g.realT;
    const baseA = c.globalAlpha;

    // --- Hull bar
    const bw = Math.min(280, W * 0.26), bx = 22, by = 34, bh = 14;
    this.panel(c, bx - 10, 12, bw + 20, 64);
    c.font = this.font(11, 800);
    c.textAlign = 'left';
    c.fillStyle = '#9fb3d9';
    c.fillText('HULL', bx, 24);
    c.textAlign = 'right';
    c.fillStyle = '#ffffff';
    c.fillText(`${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`, bx + bw, 24);
    const hpK = clamp(p.hp / p.maxHp, 0, 1);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(bx, by, bw * u.hpLag, bh);
    const hpCol = hpK > 0.5 ? '#4df3ff' : hpK > 0.25 ? '#ffe14d' : '#ff2e55';
    c.fillStyle = p.hurtFlash > 0 ? '#ffffff' : hpCol;
    c.fillRect(bx, by, bw * hpK, bh);
    c.fillStyle = 'rgba(3,4,11,0.8)';
    for (let v = 25; v < p.maxHp; v += 25) c.fillRect(bx + bw * v / p.maxHp - 1, by, 2, bh);

    // --- Dash meter
    const dk = p.dashCdT > 0 ? 1 - p.dashCdT / p.s.dashCd : 1;
    c.font = this.font(10, 800);
    c.textAlign = 'left';
    c.fillStyle = dk >= 1 ? '#4df3ff' : '#56648a';
    c.fillText('DASH', bx, by + bh + 16);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(bx + 40, by + bh + 12, bw - 40, 6);
    c.fillStyle = dk >= 1 ? '#4df3ff' : '#2a7fa0';
    c.fillRect(bx + 40, by + bh + 12, (bw - 40) * dk, 6);

    // --- Wave (top-centre)
    c.textAlign = 'center';
    c.font = this.font(22, 900);
    c.fillStyle = '#ffffff';
    this.spaced(c, `WAVE ${g.wave}`, W / 2, 30, 3);
    const hostiles = g.enemies.length + g.director.remaining;
    c.font = this.font(11, 700);
    c.fillStyle = '#9fb3d9';
    c.fillText(g.waveClearing ? 'CLEAR' : `${hostiles} HOSTILE${hostiles === 1 ? '' : 'S'}  ·  ${formatTime(g.stats.time)}`, W / 2, 52);

    // --- Boss bar
    const boss = g.boss;
    if (boss && !boss.dead && boss.active) {
      const w = Math.min(560, W * 0.5), x = W / 2 - w / 2, y = 72;
      c.font = this.font(12, 900);
      c.fillStyle = '#ff4d7a';
      this.spaced(c, boss.name, W / 2, y, 4);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(x, y + 12, w, 10);
      c.fillStyle = boss.flash > 0 ? '#ffffff' : boss.phase === 3 ? '#ff2ee0' : '#ff2e4d';
      c.fillRect(x, y + 12, w * clamp(boss.hpK, 0, 1), 10);
      c.fillStyle = 'rgba(3,4,11,0.9)';
      c.fillRect(x + w * 0.33 - 1, y + 12, 2, 10);
      c.fillRect(x + w * 0.66 - 1, y + 12, 2, 10);
    }

    // --- Off-screen boss pointer
    if (boss && !boss.dead) {
      const z = g.cam.zoom;
      const sx = (boss.x - g.cam.x) * z + W / 2, sy = (boss.y - g.cam.y) * z + H / 2;
      const m = 40;
      if (sx < -boss.r * z || sx > W + boss.r * z || sy < -boss.r * z || sy > H + boss.r * z) {
        const px = clamp(sx, m, W - m), py = clamp(sy, m + 60, H - m);
        const a = Math.atan2(sy - H / 2, sx - W / 2);
        const pulse = 0.6 + 0.4 * Math.sin(t * 8);
        c.save();
        c.translate(px, py);
        c.rotate(a);
        c.globalAlpha = baseA * pulse;
        c.fillStyle = '#ff2e4d';
        c.beginPath(); c.moveTo(16, 0); c.lineTo(-10, -11); c.lineTo(-5, 0); c.lineTo(-10, 11); c.closePath();
        c.fill();
        c.restore();
        c.globalAlpha = baseA;
      }
    }

    // --- Score + multiplier (top-right)
    const rx = W - 24;
    c.textAlign = 'right';
    c.font = this.font(30, 900);
    c.fillStyle = '#ffffff';
    c.fillText(formatNum(u.scoreShown), rx, 30);
    c.font = this.font(11, 700);
    c.fillStyle = '#56648a';
    c.fillText(`HI ${formatNum(Math.max(g.highScore, g.score))}`, rx, 56);
    const mult = g.mult;
    if (mult > 1 || g.combo > 0) {
      const pop = 1 + (u.multPop > 0 ? Ease.outBack(u.multPop / 0.35) * 0.5 : 0);
      c.save();
      c.translate(rx - 30, 92);
      c.scale(pop, pop);
      c.font = this.font(28, 900);
      c.textAlign = 'center';
      const hue = mult >= 10 ? (t * 200) % 360 : 50 - mult * 3;
      c.fillStyle = `hsl(${hue}, 100%, 62%)`;
      c.fillText(`x${mult}`, 0, 0);
      c.restore();
      c.font = this.font(10, 700);
      c.fillStyle = '#9fb3d9';
      c.fillText(`${g.combo} COMBO`, rx - 64, 92);
      // Combo decay timer + progress to next tier
      const w = 120, x = rx - w;
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(x, 112, w, 4);
      c.fillStyle = '#ffe14d';
      c.fillRect(x, 112, w * clamp(g.comboT / 3.5, 0, 1), 4);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(x, 118, w * ((g.combo % 10) / 10), 2);
    }

    // --- XP bar (bottom)
    const xk = clamp(p.xp / p.xpNext, 0, 1);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(0, H - 6, W, 6);
    c.fillStyle = COL.xp;
    c.fillRect(0, H - 6, W * xk, 6);
    c.textAlign = 'left';
    c.font = this.font(12, 900);
    c.fillStyle = COL.xp;
    c.fillText(`LV ${p.level}`, 14, H - 20);

    // --- Build (bottom-left icons)
    let ix = 70;
    for (const id of p.upgradeOrder) {
      const up = UPGRADES.find(q => q.id === id);
      const col = RARITY[up.rarity].color;
      c.globalAlpha = baseA * 0.9;
      drawIcon(c, id, ix, H - 22, 8, col, 1.6);
      c.font = this.font(9, 800);
      c.fillStyle = '#ffffff';
      c.fillText(p.upgrades[id], ix + 9, H - 14);
      ix += 30;
    }
    c.globalAlpha = baseA;

    c.textAlign = 'right';
    c.font = this.font(10, 600);
    c.fillStyle = '#3d4a6e';
    c.fillText(`P pause  ·  M sound ${Sound.muted ? 'off' : 'on'}`, W - 14, H - 18);
  },

  bannerDraw(c, g) {
    const b = g.banner;
    if (!b) return;
    const k = b.t, inT = 0.28, outT = 0.45;
    const a = k < inT ? k / inT : k > b.dur - outT ? (b.dur - k) / outT : 1;
    const s = k < inT ? 1.8 - 0.8 * Ease.outCubic(k / inT) : 1 + (k - inT) * 0.03;
    c.save();
    c.translate(g.W / 2, g.H * 0.3);
    c.scale(s, s);
    c.globalAlpha = clamp(a, 0, 1);
    c.textAlign = 'center';
    c.font = this.font(Math.min(64, g.W / 12), 900);
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = b.color;
    this.spaced(c, b.text, 0, 0, 6);
    c.globalCompositeOperation = 'source-over';
    if (b.sub) {
      c.font = this.font(15, 600);
      c.fillStyle = '#d6e2ff';
      c.fillText(b.sub, 0, 46);
    }
    c.restore();
  },

  // ----------------------------------------------------------- upgrade cards
  cardRects(g) {
    const n = g.choices.length, W = g.W, H = g.H;
    const gap = 26;
    const cw = Math.min(250, (W - 60 - gap * (n - 1)) / n);
    const ch = Math.min(cw * 1.4, H * 0.55);
    const x0 = W / 2 - (cw * n + gap * (n - 1)) / 2;
    const y = H / 2 - ch / 2 + 40;
    return g.choices.map((_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }));
  },

  upgrade(c, g) {
    const W = g.W, H = g.H, p = g.player;
    const fade = clamp(g.cardT / 0.3, 0, 1);
    c.fillStyle = `rgba(2,3,10,${0.72 * fade})`;
    c.fillRect(0, 0, W, H);

    const rects = this.cardRects(g);
    const top = rects[0].y;
    c.globalAlpha = fade;
    c.textAlign = 'center';
    c.font = this.font(Math.min(40, W / 20), 900);
    c.fillStyle = g.director.isBoss ? '#ffd24d' : '#5dffb0';
    this.spaced(c, g.director.isBoss ? 'BOSS REWARD' : `WAVE ${g.wave} CLEARED`, W / 2, top - 70, 4);
    c.font = this.font(14, 700);
    c.fillStyle = '#9fb3d9';
    this.spaced(c, 'CHOOSE AN UPGRADE', W / 2, top - 34, 4);

    rects.forEach((r, i) => {
      const u = g.choices[i];
      const rar = RARITY[u.rarity];
      const lv = p.upgrades[u.id] || 0;
      const appear = clamp((g.cardT - i * 0.09) / 0.38, 0, 1);
      if (appear <= 0) return;
      const h = g.ui.cardHover[i];
      let s = (0.3 + 0.7 * Ease.outBack(appear)) * (1 + 0.05 * h);
      let a = Math.min(1, appear * 2.5), lift = -10 * h, flash = 0;
      if (g.chosen >= 0) {
        const k = 1 - g.chosenT / 0.35;
        if (i === g.chosen) { s *= 1 + 0.12 * Math.sin(k * Math.PI); flash = 1 - k; }
        else { a *= 1 - k; lift += 60 * k * k; }
      }
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + lift;
      c.save();
      c.globalAlpha = a;
      c.translate(cx, cy);
      c.scale(s, s);
      const w = r.w, hh = r.h;

      // Card body
      this.rr(c, -w / 2, -hh / 2, w, hh, 14);
      c.fillStyle = 'rgba(9,13,32,0.94)';
      c.fill();
      if (h > 0.01 || flash > 0) {
        c.save();
        c.shadowColor = rar.color;
        c.shadowBlur = 30 * Math.max(h, flash);
        c.strokeStyle = rar.color;
        c.lineWidth = 3;
        c.stroke();
        c.restore();
      }
      c.strokeStyle = rar.color;
      c.lineWidth = 2;
      c.stroke();
      if (flash > 0) {
        c.globalAlpha = a * flash * 0.6;
        c.fillStyle = '#ffffff';
        c.fill();
        c.globalAlpha = a;
      }

      // Rarity strip
      c.fillStyle = rar.color;
      c.globalAlpha = a * 0.15;
      c.fillRect(-w / 2 + 2, -hh / 2 + 14, w - 4, 26);
      c.globalAlpha = a;
      c.font = this.font(11, 900);
      c.fillStyle = rar.color;
      c.textAlign = 'center';
      this.spaced(c, rar.label, 0, -hh / 2 + 27, 4);

      // Icon medallion (gently bobbing)
      const iy = -hh * 0.2 + Math.sin(g.realT * 3 + i) * 3;
      c.strokeStyle = rar.color;
      c.globalAlpha = a * 0.35;
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, iy, 36, 0, TAU); c.stroke();
      c.globalAlpha = a * 0.1;
      c.fillStyle = rar.color;
      c.fill();
      c.globalAlpha = a;
      drawIcon(c, u.id, 0, iy, 20, '#ffffff', 2.6);
      drawIcon(c, u.id, 0, iy, 20, rar.color, 1.2);

      // Name + description
      c.font = this.font(Math.min(19, w / 11), 900);
      c.fillStyle = '#ffffff';
      c.fillText(u.name.toUpperCase(), 0, hh * 0.04);
      c.font = this.font(13, 500);
      c.fillStyle = '#b9c7e8';
      this.wrap(c, u.desc, w - 36).forEach((line, li) => c.fillText(line, 0, hh * 0.14 + li * 19));

      // Level pips
      if (!u.filler) {
        const pips = Math.min(u.max, 8), pw = 12, py = hh / 2 - 34;
        const px0 = -((pips - 1) * (pw + 4)) / 2;
        for (let k = 0; k < pips; k++) {
          c.beginPath();
          c.arc(px0 + k * (pw + 4), py, 4, 0, TAU);
          if (k < lv) { c.fillStyle = rar.color; c.fill(); }
          else if (k === lv) { c.fillStyle = '#ffffff'; c.globalAlpha = a * (0.6 + 0.4 * Math.sin(g.realT * 8)); c.fill(); c.globalAlpha = a; }
          else { c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1; c.stroke(); }
        }
        c.font = this.font(10, 700);
        c.fillStyle = '#9fb3d9';
        c.fillText(lv === 0 ? 'NEW' : `LV ${lv} → ${lv + 1}`, 0, py + 16);
      }
      c.restore();

      // Key hint under the card
      c.globalAlpha = a * fade;
      c.font = this.font(13, 900);
      c.fillStyle = h > 0.5 ? rar.color : '#56648a';
      c.textAlign = 'center';
      c.fillText(`[ ${i + 1} ]`, cx, r.y + r.h + 26 + lift);
    });
    c.globalAlpha = 1;
  },

  // ---------------------------------------------------------------- pause
  paused(c, g) {
    const W = g.W, H = g.H, p = g.player;
    c.fillStyle = 'rgba(2,3,10,0.75)';
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.font = this.font(64, 900);
    c.fillStyle = '#4df3ff';
    this.spaced(c, 'PAUSED', W / 2, H * 0.3, 10);
    const lines = [
      ['P / ESC', 'resume'], ['R', 'restart run'], ['Q', 'quit to title'],
      ['M', `sound: ${Sound.muted ? 'off' : 'on'}`], ['N', `music: ${Sound.musicOn ? 'on' : 'off'}`],
    ];
    lines.forEach(([k, v], i) => {
      const y = H * 0.42 + i * 30;
      c.font = this.font(15, 900); c.fillStyle = '#ffe14d'; c.textAlign = 'right';
      c.fillText(k, W / 2 - 12, y);
      c.font = this.font(15, 500); c.fillStyle = '#d6e2ff'; c.textAlign = 'left';
      c.fillText(v, W / 2 + 12, y);
    });
    this.buildRow(c, p, W / 2, H * 0.42 + lines.length * 30 + 50);
  },

  buildRow(c, p, cx, y, label = 'CURRENT BUILD') {
    const ids = p.upgradeOrder;
    c.textAlign = 'center';
    c.font = this.font(12, 800);
    c.fillStyle = '#9fb3d9';
    this.spaced(c, ids.length ? label : 'NO UPGRADES TAKEN', cx, y, 3);
    const step = 48, x0 = cx - (ids.length - 1) * step / 2;
    ids.forEach((id, i) => {
      const up = UPGRADES.find(q => q.id === id);
      const x = x0 + i * step;
      drawIcon(c, id, x, y + 34, 13, RARITY[up.rarity].color, 2);
      c.font = this.font(10, 800);
      c.fillStyle = '#ffffff';
      c.fillText(`${p.upgrades[id]}`, x, y + 60);
    });
  },

  // ---------------------------------------------------------------- game over
  gameOver(c, g) {
    const W = g.W, H = g.H, k = g.goT, p = g.player, t = g.realT;
    c.fillStyle = `rgba(2,3,10,${Math.min(0.8, k * 1.5)})`;
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';

    const size = Math.min(84, W / 10);
    c.font = this.font(size, 900);
    const jitter = k < 0.6 ? (0.6 - k) * 30 : (Math.random() < 0.03 ? 6 : 0);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = Math.min(1, k * 2);
    c.fillStyle = '#ff2e55';
    this.spaced(c, 'SIGNAL LOST', W / 2 + rand(-jitter, jitter), H * 0.2, 8);
    c.fillStyle = '#2ee6ff';
    c.globalAlpha = Math.min(0.5, k);
    this.spaced(c, 'SIGNAL LOST', W / 2 + rand(-jitter, jitter) + 3, H * 0.2 + 2, 8);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    const rows = [
      ['SCORE', formatNum(g.ui.goScore)],
      ['WAVE REACHED', String(g.wave)],
      ['TIME SURVIVED', formatTime(g.stats.time)],
      ['ENEMIES DESTROYED', formatNum(g.stats.kills)],
      ['MAX COMBO', formatNum(g.stats.maxCombo)],
      ['LEVEL', String(p.level)],
    ];
    const y0 = H * 0.33, lh = 34, colW = Math.min(200, W * 0.3);
    rows.forEach(([label, val], i) => {
      const rk = clamp((k - 0.5 - i * 0.12) / 0.25, 0, 1);
      if (rk <= 0) return;
      const y = y0 + i * lh;
      c.globalAlpha = rk;
      const slide = (1 - Ease.outCubic(rk)) * 40;
      c.font = this.font(14, 700);
      c.fillStyle = '#9fb3d9';
      c.textAlign = 'right';
      c.fillText(label, W / 2 - 16 - slide, y);
      c.font = this.font(i === 0 ? 26 : 18, 900);
      c.fillStyle = i === 0 ? '#ffffff' : '#4df3ff';
      c.textAlign = 'left';
      c.fillText(val, W / 2 + 16 + slide, y);
      if (i === 0) {
        c.fillStyle = 'rgba(77,243,255,0.2)';
        c.fillRect(W / 2 - colW, y + 17, colW * 2, 1);
      }
    });
    c.globalAlpha = 1;
    const endY = y0 + rows.length * lh;

    if (g.newHigh && k > 1.3) {
      const pulse = 1 + Math.sin(t * 6) * 0.06;
      c.save();
      c.translate(W / 2, endY + 16);
      c.scale(pulse, pulse);
      c.font = this.font(22, 900);
      c.fillStyle = `hsl(${(t * 180) % 360}, 100%, 65%)`;
      c.textAlign = 'center';
      this.spaced(c, '★ NEW HIGH SCORE ★', 0, 0, 4);
      c.restore();
    } else if (k > 1.3) {
      c.font = this.font(13, 700);
      c.fillStyle = '#56648a';
      c.fillText(`HIGH SCORE  ${formatNum(g.highScore)}`, W / 2, endY + 16);
    }

    // Who got you?
    const kf = Faces.get(g.killer);
    if (kf && k > 0.9 && W >= 900) {
      const kx = W / 2 - colW - 150, ky = y0 + 70;
      const sl = FACE_SLOTS.find(q => q.id === g.killer);
      const pop = Ease.outBack(clamp((k - 0.9) / 0.4, 0, 1));
      c.globalAlpha = clamp((k - 0.9) * 3, 0, 1);
      c.font = this.font(12, 800);
      c.fillStyle = '#ff5a6e';
      c.textAlign = 'center';
      this.spaced(c, 'TAKEN OUT BY', kx, ky - 62, 3);
      drawFace(c, kf, kx, ky + Math.sin(t * 2) * 3, 44 * pop, sl.color, false, Math.sin(t * 1.5) * 0.1);
      c.font = this.font(14, 900);
      c.fillStyle = sl.color;
      c.fillText(sl.name, kx, ky + 66);
      c.globalAlpha = 1;
    }

    if (k > 1.1) {
      c.globalAlpha = Math.min(1, (k - 1.1) * 3);
      this.buildRow(c, p, W / 2, endY + 60, 'FINAL BUILD');
    }

    if (k > 1.4) {
      c.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
      c.font = this.font(22, 900);
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      this.spaced(c, 'PRESS  R  TO  RESTART', W / 2, H - 70, 3);
      c.globalAlpha = 0.6;
      c.font = this.font(12, 600);
      c.fillStyle = '#9fb3d9';
      c.fillText('ESC — MAIN MENU', W / 2, H - 40);
    }
    c.globalAlpha = 1;
  },
};
