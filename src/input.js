// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard, touch and gamepad all funnel
// through here, which is what lets the mobile build reuse the same game code.

import { clamp, wrapAngle } from './vec.js';

/**
 * How the mouse turns the frame. 'aim': the shield turns to face the cursor,
 * at the frame's own turn speed. 'turn': travel turns it, right or back
 * clockwise and left or forward counter-clockwise. 'turnx': sideways travel
 * alone turns it.
 */
export const MOUSE_MODES = ['aim', 'turn', 'turnx'];
/** Mouse, turn modes: radians of turn per pixel of travel at speed 1 (a full turn in about 630 px). */
export const MOUSE_SENS = 0.01;
/** Aim: a cursor nearer the pivot than this (world px) has no direction worth turning to; the last one holds. */
export const AIM_DEADZONE = 24;
/** Aim: the share of the way to the cursor the frame is asked to turn each frame; under 1 so the spin's own ramp never carries it past. */
export const AIM_GAIN = 0.6;
/** Aim: within this of the cursor's direction the frame has arrived, radians (a thirtieth of a degree). */
export const AIM_SETTLE = 0.0006;
/** Aim: this much travel (px) after another input has turned the frame hands it back to the mouse; less is a nudge of the desk. */
export const AIM_WAKE = 4;
/** Scroll wheel: radians per notch (fifteen degrees). */
export const WHEEL_STEP = Math.PI / 12;
/** The rate the mouse's turn is paced to when no fighter says otherwise, radians per second; in play it is the fighter's own turn speed, so a mouse never out-spins a stick or a touch button. */
export const MOUSE_TURN_RATE = 5;
/** The most travel one event is believed, pixels: more is a pointer-lock artefact (the cursor being re-centred), not a hand. */
export const MOUSE_MAX_STEP = 300;
/** Milliseconds after the pointer is captured or released during which its travel is ignored: browsers report a jump then. */
export const LOCK_SETTLE_MS = 120;
/** Turn modes: the most turn the mouse can be owed, in seconds of turning at the frame's rate; a flick the frame cannot follow within this is cut, so it never spins on long after the hand has stopped. */
export const SPIN_BACKLOG_SECONDS = 0.25;

/**
 * The turn a piece of mouse travel asks for in a turn mode: right is
 * clockwise and left counter-clockwise; with `both`, back and forward too,
 * the two adding up. Radians, at mouse speed `speed`. Pure, so a test can
 * read it.
 */
export function travelSpin(dx, dy, both = true, speed = 1) {
  return (dx + (both ? dy : 0)) * MOUSE_SENS * speed;
}

/**
 * One frame's turn command to bring `current` round to `target` the short
 * way, at `rate`: full rate while far, then a share of the rest each frame so
 * the frame arrives without swinging past. Pure, so a test can read it.
 */
export function aimTurn(current, target, rate, dt) {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) < AIM_SETTLE) return 0;
  const room = rate * Math.max(dt, 1 / 240);
  return clamp((AIM_GAIN * delta) / room, -1, 1);
}

/**
 * One frame's turn command from the turn the mouse has asked for and not yet
 * had: as much of it as the rate allows this frame, and the rest carried,
 * cut to the backlog. Pure, so a test can read it.
 */
export function spinToTurn(spin, dt, rate = MOUSE_TURN_RATE, backlog = rate * SPIN_BACKLOG_SECONDS) {
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
    // Mouse, in one of MOUSE_MODES. Aiming, the frame turns to face the
    // cursor (`sx`, `sy`, canvas pixels): `aiming` is whether the mouse is
    // the one turning (another input turning takes over until the mouse
    // moves again) and `target` the cursor's direction from the pivot. In
    // a turn mode, travel turns the frame, a fraction of a degree per pixel.
    // Either way the wheel nudges a notch at a time (up is clockwise), and
    // `spin` is relative turn asked for and not yet had. pollMouse() makes
    // `turn`, this frame's command. The left button thrusts and the right
    // pulls the shield in. In a turn mode the first click of a level
    // captures the pointer, so the hand can keep going; Escape gives it back.
    this.mouseMode = 'aim';
    this.mouseSpeed = 1;
    this.mouse = { left: false, right: false, sx: 0, sy: 0, hasPos: false, aiming: false, target: null, wake: 0, fine: false, nudge: 0, spin: 0, turn: 0, room: 0, credit: 0, locked: false, wantLock: false, lockRefused: false, inGame: false, settleUntil: 0 };
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
      // Refused (straight after Escape, or where the page may not capture): clicks are plain clicks until the next level.
      this.mouse.locked = false;
      this.mouse.lockRefused = true;
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
        if (e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        if (this.mouse.wantLock && !this.mouse.locked && !this.mouse.lockRefused) {
          // This click captures the mouse; it is not a thrust or a pull.
          this.lockPointer();
          return;
        }
        if (e.button === 0) this.mouse.left = true;
        else this.mouse.right = true;
        capture(e);
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
        const m = this.mouse;
        if (!m.locked) {
          const sp = toScreen(e);
          m.sx = sp.x;
          m.sy = sp.y;
          m.hasPos = true;
        }
        // Travel. A jump no hand makes in one frame, or any travel just as
        // the pointer is captured or freed, is the browser re-centring the
        // cursor and is ignored.
        const dx = typeof e.movementX === 'number' ? e.movementX : 0;
        const dy = typeof e.movementY === 'number' ? e.movementY : 0;
        if (!(dx || dy) || Math.abs(dx) > MOUSE_MAX_STEP || Math.abs(dy) > MOUSE_MAX_STEP || performance.now() < m.settleUntil) return;
        if (this.mouseMode !== 'aim') m.spin += travelSpin(dx, dy, this.mouseMode === 'turn', this.mouseSpeed);
        else if (m.fine) {
          // Fine aim on the course: sideways travel nudges, and the cursor lets go until the hand moves on its own again.
          if (m.aiming) this.stopAim();
          m.spin += travelSpin(dx, 0, false, this.mouseSpeed);
        } else if (!m.aiming) {
          m.wake += Math.abs(dx) + Math.abs(dy);
          if (m.wake >= AIM_WAKE) {
            m.aiming = true;
            m.wake = 0;
          }
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

  /** Whether a level is running. In a turn mode a click on the arena then captures the mouse; otherwise a captured mouse is let go. */
  captureMouse(on) {
    const m = this.mouse;
    m.inGame = !!on;
    m.wantLock = m.inGame && this.mouseMode !== 'aim';
    if (on) m.lockRefused = false;
    if (!m.wantLock && m.locked) {
      try {
        document.exitPointerLock?.();
      } catch (_) {
        // nothing to release
      }
    }
  }

  /** Choose how the mouse turns the frame (one of MOUSE_MODES) and, in a turn mode, how fast. */
  setMouse(mode, speed = this.mouseSpeed) {
    this.mouseMode = MOUSE_MODES.includes(mode) ? mode : 'aim';
    this.mouseSpeed = speed > 0 ? speed : 1;
    this.restMouse();
    this.captureMouse(this.mouse.inGame);
  }

  /** The mouse stops aiming: another input is turning, or the hand is nudging. Nothing is owed. */
  stopAim() {
    const m = this.mouse;
    m.aiming = false;
    m.target = null;
    m.wake = 0;
    m.turn = 0;
    m.credit = 0;
    m.spin = 0;
  }

  lockPointer() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {
        this.mouse.lockRefused = true;
      });
      else if (!this.canvas.requestPointerLock) this.mouse.lockRefused = true;
    } catch (_) {
      this.mouse.lockRefused = true;
      // Pointer lock is a courtesy: without it the mouse still turns within the page.
    }
  }

  /** Forget what the mouse asked for: nothing owed, and no aim until the hand moves. */
  restMouse() {
    const m = this.mouse;
    this.stopAim();
    m.nudge = 0;
  }

  /**
   * Make this frame's turn command from the mouse. `ctx` says what is being
   * steered: `rate` (radians a second), `current` (its angle), `origin`
   * (the world point it turns about, which the cursor's direction is read
   * from), `fine` (the course's fine aim), `canTurn` (false while nothing
   * can turn: a freeze, a pause, between shots, so nothing piles up) and
   * `turned` (what the angle actually did since the last poll, or null).
   *
   * Aiming, the command turns the frame toward the cursor. Otherwise the
   * turn asked for is paced at the rate, and what the frame fell short of
   * goes back on the account: a fighter's spin takes a few steps to build
   * and to die away, so travel that arrives in pieces would otherwise be
   * short-changed. Only while the mouse is the one turning, and a couple of
   * frames after, so another input's turn is never undone; and never a jump
   * no turn makes, which is a respawn. Call once per frame.
   */
  pollMouse(dt, ctx = null) {
    const m = this.mouse;
    const rate = ctx && ctx.rate > 0 ? ctx.rate : MOUSE_TURN_RATE;
    const room = rate * Math.max(dt, 1 / 240);
    m.fine = !!(ctx && ctx.fine);
    if (!ctx || ctx.canTurn === false) {
      this.restMouse();
      m.room = room;
      return;
    }
    // Another input turning the frame takes over from the cursor.
    if (m.aiming && (this.touchButtons.left || this.touchButtons.right || (this.pad.connected && this.pad.turn))) this.stopAim();
    if (m.nudge) {
      if (m.aiming) this.stopAim();
      m.spin += m.nudge;
      m.nudge = 0;
    }
    if (this.mouseMode === 'aim' && m.aiming && m.hasPos && ctx.origin) {
      const w = this.screenToWorld(m.sx, m.sy);
      const dx = w.x - ctx.origin.x;
      const dy = w.y - ctx.origin.y;
      if (Math.hypot(dx, dy) >= AIM_DEADZONE) m.target = Math.atan2(dy, dx);
      m.turn = m.target == null ? 0 : aimTurn(ctx.current || 0, m.target, rate, dt);
      m.spin = 0;
      m.credit = 0;
      m.room = room;
      return;
    }
    const turned = ctx.turned;
    if (turned != null && (m.turn !== 0 || m.credit > 0) && Math.abs(turned) <= 2 * m.room + 0.1) m.spin += m.turn * m.room - turned;
    const s = spinToTurn(m.spin, dt, rate);
    m.credit = s.turn !== 0 ? 2 : Math.max(0, m.credit - 1);
    m.turn = s.turn;
    m.spin = s.left;
    m.room = room;
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

    // Turning: the touch buttons, else the mouse (aiming at the cursor, or
    // its travel, made by pollMouse), else the gamepad's right stick or
    // triggers, faster the further they go.
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
