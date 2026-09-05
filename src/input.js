// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard and touch all funnel through here,
// which is what will let the mobile build reuse the same game code.

export class Input {
  constructor(canvas, screenToWorld) {
    this.canvas = canvas;
    this.screenToWorld = screenToWorld;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last poll (edge-triggered)
    this.pointer = { x: 0, y: 0, down: false, id: null };
    this.touchButtons = { left: false, right: false, whack: false, retract: false };

    window.addEventListener('keydown', (e) => {
      const k = normalizeKey(e);
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (PREVENT.has(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(normalizeKey(e)));
    window.addEventListener('blur', () => this.keys.clear());

    const toWorld = (e) => {
      const rect = canvas.getBoundingClientRect();
      return this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      this.pointer.id = e.pointerId;
      this.pointer.down = true;
      Object.assign(this.pointer, toWorld(e));
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      Object.assign(this.pointer, toWorld(e));
    });
    const release = (e) => {
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      this.pointer.down = false;
      this.pointer.id = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Wire an on-screen button (touch) to an intent flag. */
  bindTouchButton(el, name) {
    const on = (e) => {
      this.touchButtons[name] = true;
      e.preventDefault();
    };
    const off = (e) => {
      this.touchButtons[name] = false;
      e.preventDefault();
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  /** True once for the frame the key went down. */
  consumePress(key) {
    if (this.pressed.has(key)) {
      this.pressed.delete(key);
      return true;
    }
    return false;
  }

  clearPresses() {
    this.pressed.clear();
  }

  /** Build the movement intent for the player this frame. */
  intent(player) {
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k.has('ArrowLeft')) mx -= 1;
    if (k.has('ArrowRight')) mx += 1;
    if (k.has('ArrowUp')) my -= 1;
    if (k.has('ArrowDown')) my += 1;

    // Mouse / touch drag: hold to move toward the pointer.
    if (mx === 0 && my === 0 && this.pointer.down) {
      const dx = this.pointer.x - player.x;
      const dy = this.pointer.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        const k2 = Math.min(1, d / 50) / d; // slow down when nearly there
        mx = dx * k2;
        my = dy * k2;
      }
    }

    let turn = 0;
    if (k.has('a') || this.touchButtons.left) turn -= 1;
    if (k.has('d') || this.touchButtons.right) turn += 1;

    const lunge = k.has('w') || k.has(' ') || this.touchButtons.whack;
    const retract = k.has('s') || this.touchButtons.retract;
    return { mx, my, turn, lunge, retract };
  }
}

const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);

function normalizeKey(e) {
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}
