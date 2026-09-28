// Keyboard, mouse, controller and touch, turned into one intent per frame.
//
// Mouse and keyboard: the mouse looks (click the view to capture it), W A S D
// move, Space jumps (held for higher), Shift held runs, a left click fires,
// a right click or Q opens the light wormhole end and E the dark one, the
// wheel or R cycles the power-ups and 1 to 6 picks one straight away. Play
// keys go by where they are on the keyboard, not by the letter on them, so
// W A S D sit under the hand on any layout; menu shortcuts (M, F, P) go by
// letter.
//
// Controller (standard mapping): the left stick moves, the right stick looks,
// A jumps, the left stick pressed in (or X held) runs, RT fires, LB and RB
// open the light and dark ends, LT or Y cycles the power-ups, Start pauses.
//
// A touchscreen: a move stick under the left thumb, a drag anywhere on the
// right half looks, and buttons for jump, fire and the two ends.
import { PICKS } from './config.js';

const DEAD = 0.18;
const TRIGGER_ON = 0.45;
const PREVENT = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.codes = new Set();
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since the last intent, by letter
    this.codePressed = new Set();
    this.mouse = { left: false, right: false, dx: 0, dy: 0, leftPress: false, rightPress: false };
    this.wheel = 0;
    this.sens = 1; // the Mouse setting: a multiplier
    this.invert = false;
    this.autoRun = false;
    this.device = 'kb';
    this.locked = false;
    this.padPrev = [];
    this.touch = { stick: null, look: null, buttons: new Map(), lookDX: 0, lookDY: 0, press: new Set() };
    window.addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.keys.has(k)) this.pressed.add(k);
      if (!this.codes.has(e.code)) this.codePressed.add(e.code);
      this.keys.add(k);
      this.codes.add(e.code);
      this.device = 'kb';
      document.body.classList.remove('touch');
      if (PREVENT.has(e.code) && e.target === document.body) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
      this.codes.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());
    // A touch anywhere shows the touch controls (they are hidden until one), a key or the mouse hides them.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.device = 'touch';
        document.body.classList.add('touch');
      } else if (e.pointerType === 'mouse') {
        document.body.classList.remove('touch');
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      this.device = 'kb';
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPress = true;
      } else if (e.button === 2) {
        this.mouse.right = true;
        this.mouse.rightPress = true;
      }
      this.device = 'kb';
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Capture the mouse for looking (must come from a click). */
  lock() {
    if (this.locked || matchMedia('(pointer: coarse)').matches) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
    } catch (_) {
      this.canvas.requestPointerLock();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  reset() {
    this.codes.clear();
    this.keys.clear();
    this.pressed.clear();
    this.codePressed.clear();
    this.mouse.left = this.mouse.right = false;
    this.mouse.leftPress = this.mouse.rightPress = false;
    this.mouse.dx = this.mouse.dy = 0;
    this.wheel = 0;
  }

  /** A menu key pressed since the last call (by the letter on it). */
  took(k) {
    if (this.pressed.has(k)) {
      this.pressed.delete(k);
      return true;
    }
    return false;
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * The frame's intent. Looking comes back as radians to turn (`look`), taken
   * whole each frame so the view answers the mouse at the display's rate.
   */
  intent(dt) {
    const C = this.codes;
    const it = { mx: 0, mz: 0, run: false, jump: false, jumpPress: false, fire: false, firePress: false, worm: [false, false], cycle: 0, pick: null, look: [0, 0] };
    if (C.has('KeyW')) it.mz += 1;
    if (C.has('KeyS')) it.mz -= 1;
    if (C.has('KeyD')) it.mx += 1;
    if (C.has('KeyA')) it.mx -= 1;
    if (C.has('ArrowUp')) it.mz += 1;
    if (C.has('ArrowDown')) it.mz -= 1;
    if (C.has('ArrowRight')) it.mx += 1;
    if (C.has('ArrowLeft')) it.mx -= 1;
    const shift = C.has('ShiftLeft') || C.has('ShiftRight');
    it.run = this.autoRun ? !shift : shift;
    it.jump = C.has('Space');
    it.jumpPress = this.codePressed.has('Space');
    it.fire = this.mouse.left;
    it.firePress = this.mouse.leftPress;
    it.worm[0] = this.mouse.rightPress || this.codePressed.has('KeyQ');
    it.worm[1] = this.codePressed.has('KeyE');
    if (this.codePressed.has('KeyR')) it.cycle += 1;
    if (this.wheel) it.cycle += Math.sign(this.wheel);
    for (let i = 1; i <= PICKS.length; i++) if (this.codePressed.has(`Digit${i}`)) it.pick = i - 1;
    // The mouse: about a third of a degree a count at the default setting.
    const k = 0.0022 * this.sens;
    it.look[0] -= this.mouse.dx * k;
    it.look[1] -= this.mouse.dy * k * (this.invert ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPress = this.mouse.rightPress = false;
    this.wheel = 0;
    this.codePressed.clear();

    const pad = this.gamepad();
    if (pad) {
      const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > TRIGGER_ON));
      const was = (i) => !!this.padPrev[i];
      const press = (i) => b(i) && !was(i);
      const ax = (i) => {
        const v = pad.axes[i] || 0;
        return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);
      };
      const lx = ax(0);
      const ly = ax(1);
      const rx = ax(2);
      const ry = ax(3);
      if (lx || ly || rx || ry || pad.buttons.some((x) => x.pressed)) this.device = 'pad';
      it.mx += lx;
      it.mz -= ly;
      if (b(14)) it.mx -= 1;
      if (b(15)) it.mx += 1;
      if (b(12)) it.mz += 1;
      if (b(13)) it.mz -= 1;
      // Looking with a stick: faster the further it is pushed, gently at the edge of the dead zone.
      const turn = 3.2 * this.sens * dt;
      it.look[0] -= Math.sign(rx) * rx * rx * turn;
      it.look[1] -= Math.sign(ry) * ry * ry * turn * 0.7 * (this.invert ? -1 : 1);
      if (b(10) || b(2)) it.run = !this.autoRun;
      it.jump = it.jump || b(0);
      it.jumpPress = it.jumpPress || press(0);
      it.fire = it.fire || b(7);
      it.firePress = it.firePress || press(7);
      if (press(4)) it.worm[0] = true;
      if (press(5)) it.worm[1] = true;
      if (press(6) || press(3)) it.cycle += 1;
      it.pausePress = press(9);
      this.padPrev = pad.buttons.map((x) => x.pressed || x.value > TRIGGER_ON);
    }

    // Touch.
    const T = this.touch;
    if (T.stick) {
      it.mx += T.stick.x;
      it.mz -= T.stick.y;
      if (Math.hypot(T.stick.x, T.stick.y) > 0.92) it.run = true;
    }
    if (T.lookDX || T.lookDY) {
      it.look[0] -= T.lookDX * 0.006 * this.sens;
      it.look[1] -= T.lookDY * 0.006 * this.sens;
      T.lookDX = T.lookDY = 0;
    }
    if (T.buttons.get('jump')) it.jump = true;
    if (T.press.has('jump')) it.jumpPress = true;
    if (T.buttons.get('fire')) it.fire = true;
    if (T.press.has('fire')) it.firePress = true;
    if (T.press.has('w0')) it.worm[0] = true;
    if (T.press.has('w1')) it.worm[1] = true;
    if (T.press.has('cycle')) it.cycle += 1;
    T.press.clear();
    const m = Math.hypot(it.mx, it.mz);
    if (m > 1) {
      it.mx /= m;
      it.mz /= m;
    }
    return it;
  }

  /**
   * Touch play: the left half is a floating move stick; a drag on the right
   * half looks; the buttons (data-btn in the page) are pressed and held.
   */
  attachTouch(layer) {
    const T = this.touch;
    const R = 60; // px of stick travel
    const ids = new Map();
    const knob = layer.querySelector('.stick');
    layer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.device = 'touch';
      document.body.classList.add('touch');
      const btn = e.target.closest('[data-btn]');
      if (btn) {
        const name = btn.dataset.btn;
        T.buttons.set(name, true);
        T.press.add(name);
        ids.set(e.pointerId, { kind: 'btn', name, el: btn, x: e.clientX, y: e.clientY });
        btn.classList.add('live');
        // A held fire button also looks, so you can shoot and turn with one thumb.
      } else if (e.clientX < window.innerWidth / 2) {
        ids.set(e.pointerId, { kind: 'stick', x0: e.clientX, y0: e.clientY });
        T.stick = { x: 0, y: 0 };
        if (knob) {
          knob.style.left = `${e.clientX}px`;
          knob.style.top = `${e.clientY}px`;
          knob.classList.add('live');
        }
      } else {
        ids.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
      }
      try {
        layer.setPointerCapture(e.pointerId);
      } catch (_) {
        // capture is a nicety
      }
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      const d = ids.get(e.pointerId);
      if (!d) return;
      if (d.kind === 'stick') {
        let x = (e.clientX - d.x0) / R;
        let y = (e.clientY - d.y0) / R;
        const l = Math.hypot(x, y);
        if (l > 1) {
          x /= l;
          y /= l;
        }
        T.stick = { x, y };
        const k = knob && knob.querySelector('.knob');
        if (k) k.style.transform = `translate(calc(-50% + ${x * R}px), calc(-50% + ${y * R}px))`;
      } else {
        T.lookDX += e.clientX - d.x;
        T.lookDY += e.clientY - d.y;
        d.x = e.clientX;
        d.y = e.clientY;
      }
    });
    const up = (e) => {
      const d = ids.get(e.pointerId);
      if (!d) return;
      ids.delete(e.pointerId);
      if (d.kind === 'stick') {
        T.stick = null;
        if (knob) {
          knob.classList.remove('live');
          const k = knob.querySelector('.knob');
          if (k) k.style.transform = '';
        }
      } else if (d.kind === 'btn') {
        T.buttons.set(d.name, false);
        d.el.classList.remove('live');
      }
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }
}
