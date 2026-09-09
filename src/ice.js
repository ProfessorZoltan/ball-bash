// Ice hazards (Coolant Tunnels and the conduit before it). When the boss
// blocks the ball, the ball lays a trail of ice behind it for `lay` seconds;
// each piece of trail melts `life` seconds after it was laid. Vents drop
// round patches of ice that melt after `patchLife` seconds. A fighter touching
// any ice freezes for `freeze` seconds and cannot be re-frozen until it has
// stepped off the ice.
import { circleVsCapsule } from './physics.js';

export class IceTrail {
  constructor({ lay = 2, life = 2, freeze = 2, width = 30, patchLife = 5 } = {}) {
    this.lay = lay;
    this.life = life;
    this.freeze = freeze;
    this.width = width;
    this.patchLife = patchLife;
    this.patches = []; // [{ x, y, r, t }] in the order they were laid
    this.points = [];
    this.layUntil = -1;
    this.startedAt = -1;
    this.owner = null; // who laid it; their own ice never freezes them
  }

  reset() {
    this.points.length = 0;
    this.patches.length = 0;
    this.layUntil = -1;
    this.startedAt = -1;
    this.owner = null;
  }

  /** A block happened: drop the old trail and start laying a new one. */
  start(t, owner = null) {
    this.points.length = 0;
    this.layUntil = t + this.lay;
    this.startedAt = t;
    this.owner = owner;
  }

  get laying() {
    return this.layUntil > 0;
  }

  /** A vent dripped: a disc of ice at (x, y) that melts after patchLife. */
  addPatch(x, y, r, t) {
    this.patches.push({ x, y, r, t });
  }

  /** Call every physics step with the ball position. */
  update(t, ball) {
    if (this.layUntil > 0) {
      if (t <= this.layUntil) {
        const last = this.points[this.points.length - 1];
        if (!last || Math.hypot(ball.x - last.x, ball.y - last.y) >= 8) {
          this.points.push({ x: ball.x, y: ball.y, t });
        }
      } else {
        this.layUntil = -1;
      }
    }
    const cutoff = t - this.life;
    while (this.points.length && this.points[0].t < cutoff) this.points.shift();
    const patchCutoff = t - this.patchLife;
    while (this.patches.length && this.patches[0].t < patchCutoff) this.patches.shift();
  }

  /** True if the circle (x, y, r) overlaps the trail. */
  touches(c) {
    for (const p of this.patches) if (Math.hypot(c.x - p.x, c.y - p.y) < c.r + p.r) return true;
    const half = this.width / 2;
    const pts = this.points;
    for (let i = 1; i < pts.length; i++) {
      if (circleVsCapsule(c.x, c.y, c.r, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, half)) return true;
    }
    if (pts.length === 1) {
      return Math.hypot(c.x - pts[0].x, c.y - pts[0].y) < c.r + half;
    }
    return false;
  }

  /**
   * Apply the hazard to a fighter identified by `slot`. The fighter who laid
   * the trail is immune to it. Returns true on the step the fighter freezes.
   */
  affect(f, slot = null) {
    if (this.owner !== null && slot !== null && this.owner === slot) return false;
    const touching = (this.points.length > 0 || this.patches.length > 0) && this.touches(f);
    if (touching && f.frozen <= 0 && !f.iceImmune) {
      f.frozen = this.freeze;
      f.iceImmune = true;
      return true;
    }
    if (!touching && f.frozen <= 0) f.iceImmune = false;
    return false;
  }
}
