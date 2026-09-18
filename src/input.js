// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard, touch and gamepad all funnel
// through here, which is what lets the mobile build reuse the same game code.

import { clamp, wrapAngle } from './vec.js';

/** Mouse, fine mode: radians of turn per pixel of sideways travel (a full turn in about 630 px). */
export const MOUSE_SENS = 0.01;
/** Scroll wheel: radians per notch (fifteen degrees). */
export const WHEEL_STEP = Math.PI / 12;
/** The rate the mouse's turn is paced to when no fighter says otherwise, radians per second; in play it is the fighter's own turn speed, so a mouse never out-spins a stick or a touch button. */
export const MOUSE_TURN_RATE = 5;
/** The most sideways travel one event is believed, pixels: more is a pointer-lock artefact (the cursor being re-centred), not a hand. */
export const MOUSE_MAX_STEP = 300;
/** Milliseconds after the pointer is captured or released during which its travel is ignored: browsers report a jump then. */
export const LOCK_SETTLE_MS = 120;
/** Facing: how much recent travel it takes to mean a direction, pixels; less is tremor. */
export const FACE_DEADZONE = 3;
/** Facing: how quickly older travel stops counting toward the direction, seconds. */
export const FACE_TAU = 0.06;
/** Facing: within this of the direction the frame has arrived, radians; without it the frame would hunt round the last step. */
export const FACE_SETTLE = 0.01;

/**
 * One frame's turn command to bring `current` round to `target` the short
 * way: the whole of the way if the rate allows it this frame, else full rate
 * in that direction. Pure, so a test can read it.
 */
export function faceTurn(current, target, rate, dt) {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) < FACE_SETTLE) return 0;
  const room = rate * Math.max(dt, 1 / 240);
  return clamp(delta / room, -1, 1);
}
/** The most turn the mouse can be owed, radians: past this a flick is cut, so the frame never spins on after the hand has stopped. */
export const SPIN_BACKLOG = 0.6;

/**
 * One frame's turn command from the turn the mouse has asked for and not yet
 * had: as much of it as the rate allows this frame, and the rest carried,
 * cut to the backlog. Pure, so a test can read it.
 */
export function spinToTurn(spin, dt, rate = MOUSE_TURN_RATE, backlog = SPIN_BACKLOG) {
  const room = rate * Math.max(dt, 1 / 240);
  const turn = clamp(spin / room, -1, 1);
  const left = clamp(spin - turn * room, -backlog, backlog);
  return { turn, left };
}

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
    // Mouse: the frame turns, the short way round, to face the direction
    // the mouse moved in (`mx`, `my` is this frame's travel, `dirX`, `dirY`
    // the last few frames' worth, which sets `target`); the wheel nudges
    // that a notch at a time (up is clockwise); the left button thrusts and
    // the right pulls the shield in. In `spin` mode (fine aim on the course)
    // sideways travel turns instead, a fraction of a degree per pixel, with
    // `spin` the turn asked for and not yet had. pollMouse() paces either
    // into `turn`, this frame's command. While a match is on the first click
    // captures the pointer, so the hand can keep going; Escape gives it back.
    this.mouse = { left: false, right: false, mx: 0, my: 0, dirX: 0, dirY: 0, target: null, settled: 0, nudge: 0, spin: 0, turn: 0, mode: 'face', locked: false, wantLock: false, settleUntil: 0 };
    // Gamepad (standard mapping, e.g. an Xbox controller): read once per
    // frame by pollGamepad(). Left stick moves; right stick, or the LT and RT
    // triggers, turn (left and right, at a rate set by how far they are
    // pushed); A thrusts, X pulls the shield in, Start pauses, A also acts as
    // Enter on menus.
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
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = false;
      this.mouse.right = false;
      this.restMouse();
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === canvas;
      this.restMouse();
      this.mouse.settleUntil = performance.now() + LOCK_SETTLE_MS;
    });
    document.addEventListener('pointerlockerror', () => {
      this.mouse.locked = false;
    });

    const toWorld = (e) => {
      const rect = canvas.getBoundingClientRect();
      return this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    };
    const toScreen = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const capture = (e) => {
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch (_) {
        // Synthetic or already-released pointers cannot be captured; harmless.
      }
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.left = true;
        else if (e.button === 2) this.mouse.right = true;
        else return;
        capture(e);
        if (this.mouse.wantLock && !this.mouse.locked) this.lockPointer();
        e.preventDefault();
        return;
      }
      if (this.pointer.id !== null && this.pointer.id !== e.pointerId) return;
      this.pointer.id = e.pointerId;
      this.pointer.down = true;
      this.pointer.type = e.pointerType;
      Object.assign(this.pointer, toWorld(e));
      const sp = toScreen(e);
      Object.assign(this.joystick, { active: true, ox: sp.x, oy: sp.y, dx: 0, dy: 0 });
      capture(e);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        // Travel this frame. A jump no hand makes in one frame, or any travel
        // just as the pointer is captured or freed, is the browser re-centring
        // the cursor and is ignored.
        const dx = typeof e.movementX === 'number' ? e.movementX : 0;
        const dy = typeof e.movementY === 'number' ? e.movementY : 0;
        if ((dx || dy) && Math.abs(dx) <= MOUSE_MAX_STEP && Math.abs(dy) <= MOUSE_MAX_STEP && performance.now() >= this.mouse.settleUntil) {
          this.mouse.mx += dx;
          this.mouse.my += dy;
        }
        return;
      }
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
      if (e.pointerType === 'mouse') {
        if (e.type === 'pointercancel' || e.button === 0) this.mouse.left = false;
        if (e.type === 'pointercancel' || e.button === 2) this.mouse.right = false;
        return;
      }
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
    canvas.addEventListener(
      'wheel',
      (e) => {
        // A notch up is clockwise, a notch down counter-clockwise; a trackpad's finer steps add up the same way.
        const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100;
        if (notches) this.mouse.nudge -= notches * WHEEL_STEP;
        e.preventDefault();
      },
      { passive: false }
    );
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

  /** Whether a click on the arena should capture the mouse (a match is on); off, a captured mouse is let go. */
  captureMouse(on) {
    this.mouse.wantLock = !!on;
    if (!on && this.mouse.locked) {
      try {
        document.exitPointerLock?.();
      } catch (_) {
        // nothing to release
      }
    }
  }

  lockPointer() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      // Pointer lock is a courtesy: without it the mouse still turns within the page.
    }
  }

  /** Forget where the mouse was going: nothing owed, no direction to reach. */
  restMouse() {
    const m = this.mouse;
    m.mx = 0;
    m.my = 0;
    m.dirX = 0;
    m.dirY = 0;
    m.target = null;
    m.settled = 0;
    m.nudge = 0;
    m.spin = 0;
    m.turn = 0;
  }

  /**
   * Turn the mouse's travel since last frame into this frame's turn command,
   * at the fighter's own turn rate. `current` is the angle being steered
   * (the frame's, or the pulses' heading on the course). In `face` mode the
   * frame turns the short way to face the direction the mouse moved; in
   * `spin` mode sideways travel turns it a fraction of a degree per pixel.
   * Call once per frame.
   */
  pollMouse(dt, rate = MOUSE_TURN_RATE, current = 0, mode = 'face') {
    const m = this.mouse;
    const r = rate > 0 ? rate : MOUSE_TURN_RATE;
    if (mode !== m.mode) {
      // A change of mode owes nothing from the last one.
      this.restMouse();
      m.mode = mode;
    }
    if (mode === 'spin') {
      m.spin += m.mx * MOUSE_SENS + m.nudge;
      const s = spinToTurn(m.spin, dt, r);
      m.turn = s.turn;
      m.spin = s.left;
    } else {
      // Recent travel, older frames fading out: its direction is the target once there is enough of it to be a direction.
      const k = Math.exp(-Math.max(dt, 0) / FACE_TAU);
      m.dirX = m.dirX * k + m.mx;
      m.dirY = m.dirY * k + m.my;
      if (Math.hypot(m.dirX, m.dirY) >= FACE_DEADZONE) m.target = Math.atan2(m.dirY, m.dirX);
      if (m.nudge) m.target = wrapAngle((m.target == null ? current : m.target) + m.nudge);
      m.turn = m.target == null ? 0 : faceTurn(current, m.target, r, dt);
      // Arrived, and stayed a few frames (a fighter's spin takes a frame to
      // die away, and would coast past): at rest until the hand moves again.
      m.settled = m.target != null && m.turn === 0 ? m.settled + 1 : 0;
      if (m.settled >= 3) m.target = null;
    }
    m.mx = 0;
    m.my = 0;
    m.nudge = 0;
  }

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
    void player;
    const k = this.keys;
    let mx = 0;
    let my = 0;
    // WASD moves; the arrows do the same.
    if (k.has('a') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('d') || k.has('ArrowRight')) mx += 1;
    if (k.has('w') || k.has('ArrowUp')) my -= 1;
    if (k.has('s') || k.has('ArrowDown')) my += 1;

    if (mx === 0 && my === 0 && this.joystick.active) {
      // Touch: direction and speed come from the drag offset, not from
      // where the finger is on the map.
      const j = this.joystick;
      const len = Math.hypot(j.dx, j.dy);
      if (len > j.dead) {
        const mag = Math.min(1, (len - j.dead) / (j.radius - j.dead));
        mx = (j.dx / len) * mag;
        my = (j.dy / len) * mag;
      }
    }

    // Gamepad: the left stick moves when nothing else does.
    const pad = this.pad;
    if (mx === 0 && my === 0 && pad.connected && (pad.mx || pad.my)) {
      mx = pad.mx;
      my = pad.my;
    }

    // Turning: the touch buttons, else the mouse (facing where it moved, paced
    // by pollMouse), else the gamepad's right stick or triggers, faster the
    // further they go.
    let turn = 0;
    if (this.touchButtons.left) turn -= 1;
    if (this.touchButtons.right) turn += 1;
    if (turn === 0 && this.mouse.turn) turn = this.mouse.turn;
    if (turn === 0 && pad.connected && pad.turn) turn = clamp(pad.turn, -1, 1);

    const lunge = this.mouse.left || k.has(' ') || this.touchButtons.whack || (pad.connected && pad.lunge);
    const retract = this.mouse.right || this.touchButtons.retract || (pad.connected && pad.retract);
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
