// Input layer. Produces a single "intent" object per frame so the game logic
// never touches raw events. Mouse, keyboard, touch and gamepad all funnel
// through here, which is what lets the mobile build reuse the same game code.

import { clamp, wrapAngle } from './vec.js';

/** Scroll wheel: radians per notch (fifteen degrees). */
export const WHEEL_STEP = Math.PI / 12;
/** The rate the mouse's turn is paced to when no fighter says otherwise, radians per second; in play it is the fighter's own turn speed, so a mouse never out-spins a stick or a touch button. */
export const MOUSE_TURN_RATE = 5;
/** The most travel one event is believed, pixels: more is a pointer-lock artefact (the cursor being re-centred), not a hand. */
export const MOUSE_MAX_STEP = 300;
/** Milliseconds after the pointer is captured or released during which its travel is ignored: browsers report a jump then. */
export const LOCK_SETTLE_MS = 120;
/** The most turn the mouse can be owed, radians: past this an arc drawn faster than the frame can turn is cut, so the frame never spins on long after the hand has stopped. */
export const SPIN_BACKLOG = 1.2;
/** An arc drawn with the mouse turns the frame by the arc's own angle. The path is read in segments this long, pixels; shorter has no heading worth reading. */
export const ARC_SEGMENT = 4;
/** A stroke's unfinished last segment still counts once the hand pauses, if it is at least this long, pixels. */
export const ARC_TAIL = 2;
/** A heading change past this between two segments is a hand going back the way it came, not an arc, and turns nothing. Radians (about 120 degrees). */
export const ARC_MAX_STEP = 2.1;
/** A pause this long ends a stroke: the next segment begins a new one rather than turning from where the last left off. Milliseconds. */
export const ARC_STROKE_GAP_MS = 150;

/**
 * One segment of the mouse's path: its heading, and how far the path turned
 * from the segment before (nothing for the first of a stroke, and nothing for
 * a reversal). Clockwise on screen is positive, as the frame's angle is.
 * Pure, so a test can read it.
 */
export function arcTurn(prevHeading, sx, sy) {
  const heading = Math.atan2(sy, sx);
  if (prevHeading == null) return { heading, turn: 0 };
  const d = wrapAngle(heading - prevHeading);
  return { heading, turn: Math.abs(d) <= ARC_MAX_STEP ? d : 0 };
}

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
    // Mouse: an arc drawn with it turns the frame by the arc's angle, the
    // same way round; a straight line turns nothing. The path is read in
    // short segments (`segX`, `segY` is the one being drawn, `heading` the
    // last one's direction) and each segment adds to `spin` how far the
    // path turned since the one before; the wheel adds a notch at a time
    // (up is clockwise). pollMouse() paces `spin` into `turn`, this frame's
    // command. The left button thrusts and the right pulls the shield in.
    // While a match is on the first click captures the pointer, so the hand
    // can keep going; Escape gives it back.
    this.mouse = { left: false, right: false, segX: 0, segY: 0, heading: null, strokeAt: 0, nudge: 0, spin: 0, turn: 0, room: 0, credit: 0, locked: false, wantLock: false, settleUntil: 0 };
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
        // Travel. A jump no hand makes in one frame, or any travel just as
        // the pointer is captured or freed, is the browser re-centring the
        // cursor and is ignored.
        const dx = typeof e.movementX === 'number' ? e.movementX : 0;
        const dy = typeof e.movementY === 'number' ? e.movementY : 0;
        const now = performance.now();
        if ((dx || dy) && Math.abs(dx) <= MOUSE_MAX_STEP && Math.abs(dy) <= MOUSE_MAX_STEP && now >= this.mouse.settleUntil) this.travel(dx, dy, now);
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

  /** A piece of mouse travel: it joins the segment being drawn, and a segment long enough to have a heading turns the frame by how far the path bent. */
  travel(dx, dy, now) {
    const m = this.mouse;
    if (now - m.strokeAt > ARC_STROKE_GAP_MS) {
      // A pause ended the last stroke: this is a new one, with no heading yet.
      m.heading = null;
      m.segX = 0;
      m.segY = 0;
    }
    m.strokeAt = now;
    m.segX += dx;
    m.segY += dy;
    if (Math.hypot(m.segX, m.segY) < ARC_SEGMENT) return;
    const r = arcTurn(m.heading, m.segX, m.segY);
    m.heading = r.heading;
    m.spin += r.turn;
    m.segX = 0;
    m.segY = 0;
  }

  /** Forget where the mouse was going: nothing owed, no stroke in progress. */
  restMouse() {
    const m = this.mouse;
    m.segX = 0;
    m.segY = 0;
    m.heading = null;
    m.nudge = 0;
    m.spin = 0;
    m.turn = 0;
    m.credit = 0;
  }

  /**
   * Pace the turn the mouse has asked for into this frame's turn command, at
   * the fighter's own turn rate. `turned` is what the steered angle actually
   * did since the last poll (or null when nothing is known): a fighter's spin
   * takes a few steps to build and to die away, so pulsed commands would fall
   * short of the arc drawn; the difference between what was asked and what
   * was done goes back on the account. Only while the mouse is the one
   * turning, and a couple of frames after, so another input's turn is never
   * undone; and never a jump no turn makes, which is a respawn. Call once
   * per frame.
   */
  pollMouse(dt, rate = MOUSE_TURN_RATE, turned = null) {
    const m = this.mouse;
    if (m.heading != null && performance.now() - m.strokeAt > ARC_STROKE_GAP_MS && Math.hypot(m.segX, m.segY) >= ARC_TAIL) {
      // The hand has paused: the stroke's last, unfinished segment counts too.
      m.spin += arcTurn(m.heading, m.segX, m.segY).turn;
      m.heading = null;
      m.segX = 0;
      m.segY = 0;
    }
    m.spin += m.nudge;
    m.nudge = 0;
    if (turned != null && (m.turn !== 0 || m.credit > 0) && Math.abs(turned) <= 2 * m.room + 0.1) m.spin += m.turn * m.room - turned;
    const r = rate > 0 ? rate : MOUSE_TURN_RATE;
    const s = spinToTurn(m.spin, dt, r);
    m.credit = s.turn !== 0 ? 2 : Math.max(0, m.credit - 1);
    m.turn = s.turn;
    m.spin = s.left;
    m.room = r * Math.max(dt, 1 / 240);
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

    // Turning: the touch buttons, else the mouse (an arc drawn with it, paced
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
