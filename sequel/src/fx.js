// Particles, rings, floating words and screen shake. DOM-free, so the rule
// for an enemy's end is testable: it bursts into particles that spread no
// further than its own diameter from its centre, a cloud twice its size.
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (u) => 1 - (1 - u) ** 3;

export class Fx {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.words = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.who = null; // in multiplayer, the robot whose own movement is making what is made now (see game.js)
  }

  reset() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.words.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  /**
   * Something of radius r comes apart at (x, y). Each piece flies out along
   * its own heading and eases to a stop somewhere up to 2r from the centre,
   * so the whole burst is a cloud of diameter 4r: twice the size of what
   * burst. `colors` may be one colour or a list.
   */
  explode(x, y, r, colors, count = null) {
    const list = Array.isArray(colors) ? colors : [colors];
    const n = count ?? Math.round(14 + r * 0.9);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.parts.push({
        mode: 'burst',
        ox: x,
        oy: y,
        x,
        y,
        dx: Math.cos(a),
        dy: Math.sin(a),
        reach: 2 * r * Math.sqrt(rand(0.12, 1)), // spread evenly over the disc, never past 2r
        age: 0,
        life: rand(0.45, 0.85),
        color: list[i % list.length],
        size: rand(1.6, 3.2) * (r > 40 ? 1.6 : 1),
        spin: rand(-8, 8),
      });
    }
    this.ring(x, y, list[0], r * 2, 0.35);
  }

  /** Sparks off a surface along (nx, ny). */
  sparks(x, y, nx, ny, color, n = 8, speed = 240, spread = 1.1, life = 0.35) {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const a = base + rand(-spread, spread);
      const s = rand(0.3, 1) * speed;
      this.parts.push({ mode: 'free', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: rand(0.5, 1) * life, color, size: rand(1.2, 2.6), g: 0 });
    }
  }

  /** Dust from the robot's feet. */
  dust(x, y, color, n = 6, dir = 0) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.3, 1.3) + dir * 0.6;
      const s = rand(40, 140);
      this.parts.push({ mode: 'free', x: x + rand(-8, 8), y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, age: 0, life: rand(0.25, 0.45), color, size: rand(1.5, 3), g: 300 });
    }
  }

  ring(x, y, color, maxR = 120, life = 0.5, width = 3) {
    this.rings.push({ x, y, color, maxR, life, age: 0, width });
  }

  word(x, y, text, color = '#ffffff', life = 1.1) {
    this.words.push({ x, y, text, color, life, age: 0 });
  }

  kick(amount) {
    this.shake = Math.min(26, this.shake + amount);
  }

  blink(color = '#ffffff', amount = 0.6) {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      if (p.mode === 'burst') {
        const d = p.reach * easeOut(p.age / p.life);
        p.x = p.ox + p.dx * d;
        p.y = p.oy + p.dy * d;
      } else {
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    for (let i = this.words.length - 1; i >= 0; i--) {
      const w = this.words[i];
      w.age += dt;
      w.y -= 40 * dt;
      if (w.age >= w.life) this.words.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - 45 * dt);
    this.flash = Math.max(0, this.flash - 2.2 * dt);
  }
}
