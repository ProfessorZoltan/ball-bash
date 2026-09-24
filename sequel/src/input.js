// Keyboard, mouse and controller, turned into one intent per frame.
//
// Controller (standard mapping, e.g. Xbox): left stick or d-pad moves, A
// jumps, X held runs, the right stick points the blaster, RT fires, LB and
// RB open the light and dark wormhole ends, LT cycles the power-ups, Start
// pauses.
//
// Keyboard and mouse: W A S D move (S held on a thin platform drops through
// it), Space jumps, 2 held runs, the mouse points the blaster (or the arrow
// keys swing it toward where they point), left click or / fires, Q and E
// open the light and dark wormhole ends, 1 cycles the power-ups.
//
// Nothing is held to aim: the aim line is always up, and a press acts.
const DEAD = 0.25; // stick travel ignored round the centre
const AIM_DEAD = 0.45; // the right stick has to be pushed this far to point
const TRIGGER_ON = 0.45;
const TRIGGER_OFF = 0.3;
const ARROW_RATE = 4.2; // radians a second the arrows swing the blaster

const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', '/', 'Tab']);

function key(e) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, moved: false, seen: false };
    this.pad = { connected: false, id: '', buttons: [], axes: [], rt: false, lt: false };
    this.device = 'kb'; // what was used last: 'kb' or 'pad', for the signs and the help
    this.aimSource = 'none'; // 'mouse', 'keys', 'stick' or 'none'
    this.prevFacing = 1;
    this.prev = { fire: false, worm: [false, false], jump: false, cycle: false };
    this.blocked = { fire: false, worm: [false, false], jump: false, cycle: false };
    window.addEventListener('keydown', (e) => {
      const k = key(e);
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      this.device = 'kb';
      if (PREVENT.has(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(key(e)));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
      this.mouse.seen = true;
      this.device = 'kb';
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this.mouse.left = true;
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
      if (e.pointerType === 'mouse' && (e.button === 0 || e.type === 'pointercancel')) this.mouse.left = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    const k = this.keys;
    const pad = this.pad.connected ? this.pad : null;
    const btn = (i) => !!(pad && pad.buttons[i]);
    const ax = (i) => (pad ? pad.axes[i] || 0 : 0);

    let mx = 0;
    if (k.has('a')) mx -= 1;
    if (k.has('d')) mx += 1;
    let down = k.has('s');
    let up = k.has('w');
    if (pad) {
      const lx = ax(0);
      const ly = ax(1);
      if (!mx && Math.abs(lx) > DEAD) mx = Math.sign(lx) * Math.min(1, (Math.abs(lx) - DEAD) / (1 - DEAD) * 1.4);
      if (btn(14)) mx = -1;
      if (btn(15)) mx = 1;
      if (ly > 0.6 || btn(13)) down = true;
      if (ly < -0.6 || btn(12)) up = true;
    }
    const jumpRaw = k.has(' ') || btn(0);
    const run = k.has('2') || btn(2);

    // Aim: the right stick points; the mouse points at the cursor; the arrows swing.
    let aim = null;
    const rx = ax(2);
    const ry = ax(3);
    if (pad && Math.hypot(rx, ry) > AIM_DEAD) {
      aim = Math.atan2(ry, rx);
      this.aimSource = 'stick';
      this.mouse.moved = false;
    }
    let akx = 0;
    let aky = 0;
    if (k.has('ArrowLeft')) akx -= 1;
    if (k.has('ArrowRight')) akx += 1;
    if (k.has('ArrowUp')) aky -= 1;
    if (k.has('ArrowDown')) aky += 1;
    if (aim == null && (akx || aky)) {
      const want = Math.atan2(aky, akx);
      let d = want - ctx.aim;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = ARROW_RATE * dt;
      aim = Math.abs(d) <= step ? want : ctx.aim + Math.sign(d) * step;
      this.aimSource = 'keys';
      this.mouse.moved = false;
    }
    if (aim == null && this.mouse.seen && (this.mouse.moved || this.aimSource === 'mouse') && ctx.origin) {
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
    const rawFire = this.mouse.left || k.has('/') || !!(pad && pad.rt);
    const rawWorm = [k.has('q') || btn(4), k.has('e') || btn(5)];
    const rawCycle = k.has('1') || !!(pad && pad.lt);
    if (bl.fire && !rawFire) bl.fire = false;
    if (bl.worm[0] && !rawWorm[0]) bl.worm[0] = false;
    if (bl.worm[1] && !rawWorm[1]) bl.worm[1] = false;
    if (bl.cycle && !rawCycle) bl.cycle = false;
    if (bl.jump && !jumpRaw) bl.jump = false;
    const fire = rawFire && !bl.fire;
    const worm = [rawWorm[0] && !bl.worm[0], rawWorm[1] && !bl.worm[1]];
    const cycleNow = rawCycle && !bl.cycle;
    const jump = jumpRaw && !bl.jump;
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
      cycle: cycleNow && !this.prev.cycle,
    };
    this.prev = { fire, worm, jump, cycle: cycleNow };
    return it;
  }

  /** Coming back into play (a new level, a resume): whatever is held now does nothing until it is let go. */
  reset() {
    this.prev = { fire: false, worm: [false, false], jump: false, cycle: false };
    this.blocked = { fire: true, worm: [true, true], jump: true, cycle: true };
  }

  /** While a menu is up: nothing held carries into play. */
  swallow() {
    this.reset();
  }
}
