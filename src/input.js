// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard and touch all funnel through here,
// which is what will let the mobile build reuse the same game code.

export class Input {
  constructor(canvas, screenToWorld) {
    this.canvas = canvas;
    this.screenToWorld = screenToWorld;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last poll (edge-triggered)
    this.pointer = { x: 0, y: 0, down: false, id: null, type: 'mouse' };
    // Floating joystick for touch: the first touch point becomes the stick's
    // centre and dragging away from it sets the direction. Screen pixels.
    this.joystick = { active: false, ox: 0, oy: 0, dx: 0, dy: 0, radius: 64, dead: 8 };
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
    const toScreen = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      this.pointer.id = e.pointerId;
      this.pointer.down = true;
      this.pointer.type = e.pointerType;
      Object.assign(this.pointer, toWorld(e));
      if (e.pointerType === 'touch') {
        const sp = toScreen(e);
        Object.assign(this.joystick, { active: true, ox: sp.x, oy: sp.y, dx: 0, dy: 0 });
      }
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch (_) {
        // Synthetic or already-released pointers cannot be captured; harmless.
      }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      Object.assign(this.pointer, toWorld(e));
      const j = this.joystick;
      if (j.active) {
        const sp = toScreen(e);
        j.dx = sp.x - j.ox;
        j.dy = sp.y - j.oy;
        // Floating stick: if the finger runs past the rim, drag the centre
        // along so reversing direction is instant.
        const len = Math.hypot(j.dx, j.dy);
        if (len > j.radius) {
          const k = j.radius / len;
          j.ox = sp.x - j.dx * k;
          j.oy = sp.y - j.dy * k;
          j.dx *= k;
          j.dy *= k;
        }
      }
    });
    const release = (e) => {
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      this.pointer.down = false;
      this.pointer.id = null;
      this.joystick.active = false;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
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

    if (mx === 0 && my === 0 && this.pointer.down) {
      const j = this.joystick;
      if (j.active) {
        // Touch: direction and speed come from the drag offset, not from
        // where the finger is on the map.
        const len = Math.hypot(j.dx, j.dy);
        if (len > j.dead) {
          const mag = Math.min(1, (len - j.dead) / (j.radius - j.dead));
          mx = (j.dx / len) * mag;
          my = (j.dy / len) * mag;
        }
      } else {
        // Mouse: hold to move toward the cursor.
        const dx = this.pointer.x - player.x;
        const dy = this.pointer.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) {
          const k2 = Math.min(1, d / 50) / d; // slow down when nearly there
          mx = dx * k2;
          my = dy * k2;
        }
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
