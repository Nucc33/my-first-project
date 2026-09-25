'use strict';
// ---------------------------------------------------------------------------
// Custom character faces. The player picks a photo for the hero and for each
// enemy type on the Characters screen. Photos are cropped to a small square,
// stored in this browser's localStorage only (never uploaded or committed),
// and turned into circular sprites that replace the neon shapes in-game.
// ---------------------------------------------------------------------------

const FACE_SLOTS = [
  { id: 'player', name: 'HERO', role: "that's you", color: '#4df3ff' },
  { id: 'boss', name: 'THE BOSS', role: 'every 5 waves', color: '#ff2e4d' },
  { id: 'chaser', name: 'CHASER', role: 'hunts you down', color: '#ff3d9a' },
  { id: 'tank', name: 'TANK', role: 'big, slow, splits', color: '#4dff88' },
  { id: 'shooter', name: 'SHOOTER', role: 'snipes from range', color: '#ff8a3d' },
  { id: 'dasher', name: 'DASHER', role: 'charges in a line', color: '#b56bff' },
  { id: 'swarmer', name: 'SWARMER', role: 'comes in packs', color: '#ffe14d' },
];

const Faces = {
  data: {},      // id -> JPEG data URL (persisted)
  sprites: {},   // id -> circular canvas sprite
  msg: '', msgT: 0,

  init(canvas) {
    const saved = Store.get('faces', {});
    this.data = saved && typeof saved === 'object' ? saved : {};
    for (const id in this.data) this.build(id, this.data[id]);

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = 'image/*';
    this.input.style.display = 'none';
    document.body.appendChild(this.input);
    this.input.addEventListener('change', () => {
      const f = this.input.files && this.input.files[0];
      if (f && this.pending) this.fromFile(this.pending, f);
      this.input.value = '';
    });

    // Handled directly in the event (not the game loop): browsers only open a
    // file picker from inside a real user gesture.
    canvas.addEventListener('click', e => {
      if (Game.state !== 'faces' || e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const hit = UI.facesHit(Game, e.clientX - r.left, e.clientY - r.top);
      if (!hit) return;
      Sound.init();
      if (hit.type === 'back') Game.toTitle();
      else if (hit.type === 'play') Game.startRun();
      else if (hit.type === 'clear') { this.clear(hit.id); Sound.sfx.comboLost(); }
      else { this.pending = hit.id; this.input.click(); }
    });
  },

  fromFile(id, file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const S = 160, c = document.createElement('canvas');
      c.width = c.height = S;
      // Square crop, biased slightly upward where faces usually are.
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2;
      const sy = clamp((img.height - s) * 0.4, 0, img.height - s);
      c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, S, S);
      URL.revokeObjectURL(url);
      const d = c.toDataURL('image/jpeg', 0.85);
      this.data[id] = d;
      this.save();
      this.build(id, d);
      Sound.sfx.select();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.flash("Couldn't read that image. Try a JPG or PNG.");
    };
    img.src = url;
  },

  build(id, dataUrl) {
    const img = new Image();
    img.onload = () => {
      const S = 128, c = document.createElement('canvas');
      c.width = c.height = S;
      const x = c.getContext('2d');
      x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.clip();
      x.drawImage(img, 0, 0, S, S);
      this.sprites[id] = c;
    };
    img.src = dataUrl;
  },

  clear(id) {
    delete this.data[id];
    delete this.sprites[id];
    this.save();
  },

  save() {
    try {
      localStorage.setItem('neonrift.faces', JSON.stringify(this.data));
    } catch (e) {
      this.flash('Browser storage is full. The photo works until you close the tab.');
    }
  },

  flash(text) { this.msg = text; this.msgT = 4; },

  get(id) { return (id && this.sprites[id]) || null; },
};

// Photos must not go through the bloom pass (additive glow blows them out to
// white). While rendering, drawFace() leaves a dark disc in their place and
// records the transform; Game.composite() then draws the real photos after
// the bloom has been applied.
const FaceLayer = { target: null, world: [], ui: [] };

// Draw a circular face sprite with a neon ring (used by enemies, the player and the UI).
function drawFace(ctx, sprite, x, y, R, ringColor, flash, tilt = 0) {
  const a = ctx.globalAlpha;
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.globalCompositeOperation = 'source-over';
  if (FaceLayer.target) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    FaceLayer.target.push({ mat: ctx.getTransform(), sprite, R, a, flash });
  } else {
    ctx.drawImage(sprite, -R, -R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = Math.max(2, R * 0.12);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.restore();
}

function replayFaces(m, list) {
  for (const f of list) {
    m.setTransform(f.mat);
    m.globalAlpha = f.a;
    m.drawImage(f.sprite, -f.R, -f.R, f.R * 2, f.R * 2);
    if (f.flash) {
      m.globalAlpha = f.a * 0.75;
      m.fillStyle = '#ffffff';
      m.beginPath(); m.arc(0, 0, f.R, 0, TAU); m.fill();
    }
  }
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalAlpha = 1;
  list.length = 0;
}
