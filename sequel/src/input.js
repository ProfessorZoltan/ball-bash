// Keyboard, mouse and controller, turned into one intent per frame.
//
// Controller (standard mapping, e.g. Xbox): left stick or d-pad moves, A
// jumps, X held runs, the right stick points the blaster, RT fires, LB and
// RB open the light and dark wormhole ends, LT cycles the power-ups, Start
// pauses.
//
// Two ways to play on a keyboard (the Controls setting on the title screen):
//
//  - Mouse and keyboard (the default): A and D move, Space or W jumps, S held
//    on a thin platform drops through it, Shift held runs, the mouse points
//    the blaster and a left click fires, a right click or Q opens the light
//    wormhole end and E the dark one, the wheel or R cycles the power-ups and
//    1 to 6 picks one straight away.
//  - Keyboard only: the left hand does everything but aim. A and D move, W
//    jumps, S drops, Shift runs, Space fires, Q and E open the ends, R cycles
//    and 1 to 6 picks; the right hand aims with I J K L (or the arrows).
//
// With Run by default on, Shift (or X) held walks instead. Play keys are read
// by where they are on the keyboard, not by the letter on them, so W A S D
// sit under the hand on any layout; menu shortcuts (M, F, P) go by letter.
//
// Nothing is held to aim: the aim line is always up, and a press acts.
import { PICKS } from './config.js';

const DEAD = 0.25; // stick travel ignored round the centre
const AIM_DEAD = 0.45; // the right stick has to be pushed this far to point
const TRIGGER_ON = 0.45;
const TRIGGER_OFF = 0.3;
// Aim keys swing the blaster toward where they point: slowly at first, so a
// tap nudges it a degree or two for a careful bank shot, then at full speed.
const SWING_SLOW = 0.6; // radians a second, the moment an aim key goes down
const SWING_FAST = 4.2; // and once it has been held SWING_RAMP seconds
const SWING_RAMP = 0.35;
const WHEEL_NOTCH = 40; // px: one wheel event this big is a mouse's notch, and cycles once
const WHEEL_STEP = 100; // px of a trackpad's smaller travel that add up to a cycle

const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', '/', 'Tab']);

function key(e) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); // held, by the letter or name on the key (menus and shortcuts)
    this.codes = new Set(); // held, by where the key is (play)
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false, moved: false, seen: false };
    this.wheel = 0; // a trackpad's wheel travel not yet turned into a cycle
    this.notches = 0; // cycles the wheel has asked for, taken one a frame
    this.pad = { connected: false, id: '', buttons: [], axes: [], rt: false, lt: false };
    this.device = 'kb'; // what was used last: 'kb' or 'pad', for the signs and the help
    this.scheme = 'mouse'; // 'mouse' (mouse and keyboard) or 'keys' (keyboard only)
    this.autoRun = false; // Run by default: the run button walks instead
    this.aimSource = 'none'; // 'mouse', 'keys', 'stick' or 'none'
    this.aimHeld = 0; // seconds an aim key has been held, for the swing's ramp
    this.prevFacing = 1;
    this.prev = { fire: false, worm: [false, false], jump: false, cycle: 0, pick: null };
    this.blocked = { fire: false, worm: [false, false], jump: false, cycle: false, pick: false };
    window.addEventListener('keydown', (e) => {
      const k = key(e);
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      this.codes.add(e.code);
      this.device = 'kb';
      if (PREVENT.has(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(key(e));
      this.codes.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.codes.clear();
      this.mouse.left = false;
      this.mouse.right = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
      this.mouse.seen = true;
      // A second button pressed while one is held comes as a move, not a press.
      this.mouse.left = !!(e.buttons & 1);
      this.mouse.right = !!(e.buttons & 2);
      this.device = 'kb';
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 2)) return;
      if (e.button === 0) this.mouse.left = true;
      else this.mouse.right = true;
      this.mouse.seen = true;
      this.device = 'kb';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        // a synthetic pointer cannot be captured; nothing lost
      }
      e.preventDefault();
    });
    const up = (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0 || e.type === 'pointercancel') this.mouse.left = false;
      if (e.button === 2 || e.type === 'pointercancel') this.mouse.right = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        // A mouse's notch is one event of 100 px or so (or a few lines): one cycle each. A trackpad's
        // travel comes in many small events, and cycles once for every WHEEL_STEP of it.
        const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1);
        if (Math.abs(dy) >= WHEEL_NOTCH) {
          this.notches = Math.max(-3, Math.min(3, this.notches + Math.sign(dy)));
          this.wheel = 0;
        } else {
          this.wheel += dy;
          if (Math.abs(this.wheel) >= WHEEL_STEP) {
            this.notches = Math.max(-3, Math.min(3, this.notches + Math.sign(this.wheel)));
            this.wheel = 0;
          }
        }
        this.device = 'kb';
        e.preventDefault();
      },
      { passive: false },
    );
  }

  consume(k) {
    if (this.pressed.has(k)) {
      this.pressed.delete(k);
      return true;
    }
    return false;
  }

  /** Read the first controller. Never throws: a browser's gamepad quirk must not stop the game. */
  poll() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads || []) if (p && p.connected !== false) {
        gp = p;
        break;
      }
      const pad = this.pad;
      if (!gp) {
        pad.connected = false;
        return;
      }
      pad.connected = true;
      pad.id = gp.id;
      const down = (i) => {
        const b = gp.buttons[i];
        return !!b && (b.pressed || b.value > 0.5);
      };
      const val = (i) => {
        const b = gp.buttons[i];
        return b ? b.value || (b.pressed ? 1 : 0) : 0;
      };
      const now = [];
      for (let i = 0; i < gp.buttons.length; i++) now[i] = down(i);
      pad.rt = pad.rt ? val(7) > TRIGGER_OFF : val(7) > TRIGGER_ON;
      pad.lt = pad.lt ? val(6) > TRIGGER_OFF : val(6) > TRIGGER_ON;
      const prev = pad.buttons;
      // Menu presses ride the keyboard's queue, under names of their own:
      // a keyboard Enter already presses the focused button by itself.
      const edges = [[0, 'PadA'], [9, 'Escape'], [1, 'PadB'], [12, 'PadUp'], [13, 'PadDown']];
      for (const [i, k] of edges) if (now[i] && !prev[i]) this.pressed.add(k);
      if (now.some((b, i) => b && !prev[i])) this.device = 'pad';
      pad.buttons = now;
      pad.axes = Array.from(gp.axes || []);
      if (pad.axes.some((a) => Math.abs(a) > 0.5)) this.device = 'pad';
    } catch (_) {
      this.pad.connected = false;
    }
  }

  /**
   * This frame's intent. `ctx` carries the robot's aim and facing and where
   * its shoulder is on screen, so the mouse can be aimed from it.
   */
  intent(ctx, dt) {
    const c = this.codes;
    const keysOnly = this.scheme === 'keys';
    const pad = this.pad.connected ? this.pad : null;
    const btn = (i) => !!(pad && pad.buttons[i]);
    const ax = (i) => (pad ? pad.axes[i] || 0 : 0);

    let mx = 0;
    if (c.has('KeyA')) mx -= 1;
    if (c.has('KeyD')) mx += 1;
    let down = c.has('KeyS');
    let up = false;
    if (pad) {
      const lx = ax(0);
      const ly = ax(1);
      if (!mx && Math.abs(lx) > DEAD) mx = Math.sign(lx) * Math.min(1, (Math.abs(lx) - DEAD) / (1 - DEAD) * 1.4);
      if (btn(14)) mx = -1;
      if (btn(15)) mx = 1;
      if (ly > 0.6 || btn(13)) down = true;
      if (ly < -0.6 || btn(12)) up = true;
    }
    // Space fires on the keyboard alone; with a mouse it jumps, as W does in both.
    const jumpRaw = c.has('KeyW') || (!keysOnly && c.has('Space')) || btn(0);
    const runHeld = c.has('ShiftLeft') || c.has('ShiftRight') || btn(2);
    const run = this.autoRun ? !runHeld : runHeld;

    // Aim: the right stick points; the mouse points at the cursor; the aim keys swing.
    let aim = null;
    const rx = ax(2);
    const ry = ax(3);
    if (pad && Math.hypot(rx, ry) > AIM_DEAD) {
      aim = Math.atan2(ry, rx);
      this.aimSource = 'stick';
      this.mouse.moved = false;
    }
    const held = (a, b) => c.has(a) || (keysOnly && c.has(b));
    const akx = (held('ArrowRight', 'KeyL') ? 1 : 0) - (held('ArrowLeft', 'KeyJ') ? 1 : 0);
    const aky = (held('ArrowDown', 'KeyK') ? 1 : 0) - (held('ArrowUp', 'KeyI') ? 1 : 0);
    if (aim == null && (akx || aky)) {
      this.aimHeld += dt;
      const want = Math.atan2(aky, akx);
      let d = want - ctx.aim;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const ramp = Math.min(1, this.aimHeld / SWING_RAMP);
      const step = (SWING_SLOW + (SWING_FAST - SWING_SLOW) * ramp * ramp) * dt;
      aim = Math.abs(d) <= step ? want : ctx.aim + Math.sign(d) * step;
      this.aimSource = 'keys';
      this.mouse.moved = false;
    } else this.aimHeld = 0;
    if (aim == null && !keysOnly && this.mouse.seen && (this.mouse.moved || this.aimSource === 'mouse') && ctx.origin) {
      const dx = this.mouse.x - ctx.origin.x;
      const dy = this.mouse.y - ctx.origin.y;
      if (Math.hypot(dx, dy) > 12) {
        aim = Math.atan2(dy, dx);
        this.aimSource = 'mouse';
      }
    }
    // Nothing aiming, and the robot turned round: the blaster turns with it.
    if (aim == null && this.aimSource !== 'mouse' && ctx.facing !== this.prevFacing && Math.cos(ctx.aim) * ctx.facing < 0) aim = Math.PI - ctx.aim;
    this.prevFacing = ctx.facing;

    // Anything already held when play began (the button that started it)
    // counts only once it has been let go and pressed again.
    const bl = this.blocked;
    const rawFire = (keysOnly ? c.has('Space') : this.mouse.left) || !!(pad && pad.rt);
    const rawWorm = [c.has('KeyQ') || (!keysOnly && this.mouse.right) || btn(4), c.has('KeyE') || btn(5)];
    const rawCycle = c.has('KeyR') || !!(pad && pad.lt);
    const pickIndex = PICKS.findIndex((_, i) => c.has(`Digit${i + 1}`));
    const rawPick = pickIndex >= 0 ? PICKS[pickIndex] : null;
    if (bl.fire && !rawFire) bl.fire = false;
    if (bl.worm[0] && !rawWorm[0]) bl.worm[0] = false;
    if (bl.worm[1] && !rawWorm[1]) bl.worm[1] = false;
    if (bl.cycle && !rawCycle) bl.cycle = false;
    if (bl.jump && !jumpRaw) bl.jump = false;
    if (bl.pick && !rawPick) bl.pick = false;
    const fire = rawFire && !bl.fire;
    const worm = [rawWorm[0] && !bl.worm[0], rawWorm[1] && !bl.worm[1]];
    const cycleNow = rawCycle && !bl.cycle;
    const jump = jumpRaw && !bl.jump;
    const pickNow = bl.pick ? null : rawPick;
    // The wheel: a notch at a time, down for the next power-up, up for the one before.
    let cycle = cycleNow && !this.prev.cycle ? 1 : 0;
    if (!keysOnly && !cycle && this.notches) {
      cycle = Math.sign(this.notches);
      this.notches -= cycle;
    }
    const it = {
      mx,
      up,
      down,
      run,
      jump,
      jumpPressed: jump && !this.prev.jump,
      aim,
      fire: fire && !this.prev.fire, // pressed this frame
      worm: [worm[0] && !this.prev.worm[0], worm[1] && !this.prev.worm[1]],
      cycle, // 1 for the next power-up, -1 for the one before, 0 for neither
      pick: pickNow && pickNow !== this.prev.pick ? pickNow : null,
    };
    this.prev = { fire, worm, jump, cycle: cycleNow, pick: pickNow };
    return it;
  }

  /** Coming back into play (a new level, a resume): whatever is held now does nothing until it is let go. */
  reset() {
    this.prev = { fire: false, worm: [false, false], jump: false, cycle: false, pick: null };
    this.blocked = { fire: true, worm: [true, true], jump: true, cycle: true, pick: true };
    this.wheel = 0;
    this.notches = 0;
  }

  /** While a menu is up: nothing held carries into play. */
  swallow() {
    this.reset();
  }
}
