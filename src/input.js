// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard and touch all funnel through here,
// which is what will let the mobile build reuse the same game code.

import { clamp } from './vec.js';

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
    // Gamepad (standard mapping, e.g. an Xbox controller): read once per
    // frame by pollGamepad(). Left stick moves; right stick, or the LT and RT
    // triggers, turn (left and right, like A and D, at a rate set by how far
    // they are pushed); A thrusts, X pulls the shield in, Start pauses, A also
    // acts as Enter on menus.
    this.pad = { connected: false, id: '', mapping: '', turn: 0, mx: 0, my: 0, lunge: false, retract: false, buttons: [], rightAxes: [2, 3], error: '' };
    window.addEventListener('gamepadconnected', () => {
      this.pad.connected = true;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.pad = { ...this.pad, connected: false, turn: 0, mx: 0, my: 0, lunge: false, retract: false };
    });

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
  /** Read the first connected gamepad. Call once per frame; intent() uses the result. Never throws. */
  pollGamepad() {
    try {
      this.readGamepad();
    } catch (err) {
      // A browser quirk in the Gamepad API must never stop the game loop.
      this.pad.error = String(err && err.message ? err.message : err);
      this.pad.connected = false;
      this.pad.turn = 0;
      this.pad.mx = 0;
      this.pad.my = 0;
      this.pad.lunge = false;
      this.pad.retract = false;
    }
  }

  readGamepad() {
    const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null;
    let gp = null;
    if (pads) for (const p of pads) if (p && p.connected !== false && p.axes) { gp = p; break; }
    const pad = this.pad;
    if (!gp) {
      if (pad.connected) Object.assign(pad, { connected: false, id: '', turn: 0, mx: 0, my: 0, lunge: false, retract: false, buttons: [] });
      return;
    }
    if (!pad.connected || pad.id !== gp.id) {
      // A newly seen pad: remember it and work out where its right stick is.
      pad.id = gp.id || 'gamepad';
      pad.mapping = gp.mapping || '';
      pad.buttons = [];
      const ax = gp.axes || [];
      // Standard mapping puts the right stick on axes 2 and 3. Some non-standard
      // layouts put a trigger on axis 2 (resting at -1) and the stick on 3 and 4.
      pad.rightAxes = gp.mapping !== 'standard' && ax.length >= 5 && Math.abs(ax[2] || 0) > 0.9 ? [3, 4] : [2, 3];
    }
    pad.connected = true;
    const stick = (x, y) => {
      const len = Math.hypot(x, y);
      if (len < GAMEPAD_DEADZONE) return null;
      const mag = Math.min(1, (len - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));
      return { x: (x / len) * mag, y: (y / len) * mag, angle: Math.atan2(y, x), mag };
    };
    const ax = gp.axes || [];
    const [rx, ry] = pad.rightAxes;
    const left = stick(ax[0] || 0, ax[1] || 0);
    pad.mx = left ? left.x : 0;
    pad.my = left ? left.y : 0;
    // Right stick: only its sideways travel matters, pushed right turns clockwise.
    const tx = ax[rx] || 0;
    const stickTurn = Math.abs(tx) < GAMEPAD_DEADZONE ? 0 : Math.sign(tx) * Math.min(1, (Math.abs(tx) - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));
    void ry;
    // Triggers: LT turns left, RT turns right, harder is faster. Whichever of
    // the stick and the triggers is pushed further wins.
    const buttons = gp.buttons || [];
    const trigger = (i) => {
      const b = buttons[i];
      const v = b == null ? 0 : typeof b === 'number' ? b : b.value || (b.pressed ? 1 : 0);
      return v < TRIGGER_DEADZONE ? 0 : (v - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE);
    };
    const triggerTurn = trigger(7) - trigger(6);
    pad.turn = Math.abs(triggerTurn) > Math.abs(stickTurn) ? triggerTurn : stickTurn;
    const down = (i) => {
      const b = buttons[i];
      if (b == null) return false;
      if (typeof b === 'number') return b > 0.5; // very old Firefox reported plain numbers
      return !!(b.pressed || b.value > 0.5);
    };
    pad.lunge = down(0); // A
    pad.retract = down(2); // X
    // Edge-triggered buttons feed the same press queue as the keyboard.
    const edges = [[0, 'Enter'], [9, 'p'], [1, 'Escape']];
    const prev = pad.buttons;
    const now = [];
    for (let i = 0; i < buttons.length; i++) now[i] = down(i);
    for (const [i, key] of edges) if (now[i] && !prev[i]) this.pressed.add(key);
    pad.buttons = now;
  }

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

    // Gamepad: the left stick moves when nothing else does.
    const pad = this.pad;
    if (mx === 0 && my === 0 && pad.connected && (pad.mx || pad.my)) {
      mx = pad.mx;
      my = pad.my;
    }

    let turn = 0;
    if (k.has('a') || this.touchButtons.left) turn -= 1;
    if (k.has('d') || this.touchButtons.right) turn += 1;
    // Gamepad: the right stick turns like A and D, faster the further it is pushed.
    if (turn === 0 && pad.connected && pad.turn) turn = clamp(pad.turn, -1, 1);

    const lunge = k.has('w') || k.has(' ') || this.touchButtons.whack || (pad.connected && pad.lunge);
    const retract = k.has('s') || this.touchButtons.retract || (pad.connected && pad.retract);
    return { mx, my, turn, lunge, retract };
  }
}

const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']);
const GAMEPAD_DEADZONE = 0.22; // stick travel ignored around centre
const TRIGGER_DEADZONE = 0.08; // trigger travel ignored when resting

function normalizeKey(e) {
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}
