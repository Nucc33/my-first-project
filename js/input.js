'use strict';
// ---------------------------------------------------------------------------
// Keyboard + mouse. "pressed" edges persist until a simulation tick consumes
// them, so a tap is never lost on high-refresh displays where some rendered
// frames run zero fixed-step updates.
// ---------------------------------------------------------------------------

const Input = {
  down: new Set(),
  pressed: new Set(),
  mouse: { x: 0, y: 0, down: false, clicked: false, moved: false },
  onBlur: null,

  init(canvas) {
    this.mouse.x = window.innerWidth / 2;
    this.mouse.y = window.innerHeight / 2;
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    window.addEventListener('keydown', e => {
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.down = false;
      if (this.onBlur) this.onBlur();
    });
    const setPos = e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
    };
    canvas.addEventListener('mousemove', setPos);
    canvas.addEventListener('mousedown', e => {
      setPos(e);
      if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; }
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  isDown(...codes) { return codes.some(c => this.down.has(c)); },
  // True once per physical key press.
  hit(...codes) {
    for (const c of codes) if (this.pressed.has(c)) { this.pressed.delete(c); return true; }
    return false;
  },
  click() {
    if (this.mouse.clicked) { this.mouse.clicked = false; return true; }
    return false;
  },
  // Called after each fixed update: drop any edges nobody consumed this tick.
  endTick() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.mouse.moved = false;
  },
};
