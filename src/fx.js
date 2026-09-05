// Particles and screen shake.
import { rand } from './vec.js';

export class Effects {
  constructor() {
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
    this.rings = [];
  }

  reset() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  burst(x, y, nx, ny, count, color, speed = 260, spread = 1.2, life = 0.5) {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const a = base + rand(-spread, spread);
      const s = rand(0.3, 1) * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.5, 1) * life,
        maxLife: life,
        color,
        size: rand(1.5, 3.5),
      });
    }
  }

  ring(x, y, color, maxR = 120, life = 0.5) {
    this.rings.push({ x, y, color, maxR, life, maxLife: life });
  }

  addShake(amount) {
    this.shake = Math.min(30, this.shake + amount);
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt;
      p.vy *= 1 - 3 * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - 40 * dt);
    this.flash = Math.max(0, this.flash - 2.5 * dt);
  }
}
