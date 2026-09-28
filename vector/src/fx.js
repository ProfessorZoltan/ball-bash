// Particles: bursts, sparks, rings, rain and snow. Only for the eye, never
// for the physics, so they run on the frame's clock, not the step's.

export class FX {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.shake = 0;
    this.weather = [];
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.shake = 0;
  }

  /** A burst of `n` motes from p, spreading at `speed`, falling a little. */
  burst(p, col, n = 24, speed = 5, life = 0.7, size = 0.12, g = 6) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.35 + Math.random() * 0.65);
      this.parts.push({ p: [...p], v: [Math.cos(a) * s * v, u * v, Math.sin(a) * s * v], life, t: life, size: size * (0.6 + Math.random() * 0.8), col, g });
    }
  }

  /** Sparks off a surface, thrown out along its normal. */
  sparks(p, n, col, count = 8) {
    for (let i = 0; i < count; i++) {
      const r = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
      const v = [n[0] * 3 + r[0] * 4, n[1] * 3 + r[1] * 4, n[2] * 3 + r[2] * 4];
      this.parts.push({ p: [...p], v, life: 0.35, t: 0.35, size: 0.06, col, g: 9 });
    }
  }

  /** An enemy's end: a cloud as wide as it was, spreading from its middle. */
  explode(p, r, col) {
    this.burst(p, col, Math.round(18 + r * 30), 4 + r * 5, 0.8, 0.16 + r * 0.1, 3);
    this.burst(p, '#ffffff', 8, 3, 0.3, 0.2, 0);
    this.rings.push({ p: [...p], r: r * 0.5, grow: r * 7, life: 0.5, t: 0.5, col });
    this.shake = Math.max(this.shake, 0.12 + r * 0.1);
  }

  ring(p, col, grow = 6, life = 0.5) {
    this.rings.push({ p: [...p], r: 0.2, grow, life, t: life, col });
  }

  step(dt) {
    for (const q of this.parts) {
      q.t -= dt;
      q.v[1] -= q.g * dt;
      q.p[0] += q.v[0] * dt;
      q.p[1] += q.v[1] * dt;
      q.p[2] += q.v[2] * dt;
    }
    this.parts = this.parts.filter((q) => q.t > 0);
    for (const r of this.rings) {
      r.t -= dt;
      r.r += r.grow * dt;
    }
    this.rings = this.rings.filter((r) => r.t > 0);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    if (this.parts.length > 3000) this.parts.splice(0, this.parts.length - 3000);
  }

  /**
   * Weather round the eye: rain (streaks falling fast) or snow (drifting).
   * Motes live in a box that follows the camera, so there is always some.
   */
  weatherStep(dt, eye, kind, time) {
    if (!kind) {
      this.weather.length = 0;
      return;
    }
    const want = kind === 'rain' ? 420 : 260;
    while (this.weather.length < want) {
      this.weather.push([eye[0] + (Math.random() - 0.5) * 40, eye[1] + Math.random() * 20 - 4, eye[2] + (Math.random() - 0.5) * 40, Math.random()]);
    }
    const fall = kind === 'rain' ? 18 : 1.4;
    for (const w of this.weather) {
      w[1] -= fall * dt;
      if (kind === 'snow') {
        w[0] += Math.sin(time * 0.7 + w[3] * 20) * 0.6 * dt;
        w[2] += Math.cos(time * 0.5 + w[3] * 30) * 0.5 * dt;
      }
      if (w[1] < eye[1] - 6) w[1] += 22;
      if (w[0] < eye[0] - 20) w[0] += 40;
      if (w[0] > eye[0] + 20) w[0] -= 40;
      if (w[2] < eye[2] - 20) w[2] += 40;
      if (w[2] > eye[2] + 20) w[2] -= 40;
    }
  }
}
