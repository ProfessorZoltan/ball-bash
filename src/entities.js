import { approach, clamp, wrapAngle, TAU } from './vec.js';

export class Ball {
  constructor(radius) {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.r = radius;
    this.trail = [];
    this.held = true; // true while the countdown is running
    this.lastHitBy = null; // 'player' | 'boss' | 'wall' | 'mover'
    this.lastPaddle = null; // kind of the last fighter whose shield hit it
  }

  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  setSpeed(s) {
    const cur = this.speed;
    if (cur < 1e-6) {
      this.vx = s;
      this.vy = 0;
      return;
    }
    const k = s / cur;
    this.vx *= k;
    this.vy *= k;
  }

  clampSpeed(min, max) {
    const s = this.speed;
    if (s < min) this.setSpeed(min);
    else if (s > max) this.setSpeed(max);
  }

  launch(x, y, angle, speed) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.held = false;
    this.trail.length = 0;
    this.lastHitBy = null;
    this.lastPaddle = null;
  }

  pushTrail(max) {
    this.trail.push({ x: this.x, y: this.y });
    while (this.trail.length > max) this.trail.shift();
  }
}

/**
 * A character (player or boss): a circular body carrying a flat paddle shield.
 * The paddle is a segment held `paddleOffset` px in front of the body,
 * perpendicular to the facing direction.
 */
export class Fighter {
  constructor(opts = {}) {
    Object.assign(
      this,
      {
        x: 0,
        y: 0,
        r: 22,
        angle: 0,
        paddleWidth: 110,
        paddleBase: 36,
        paddleThick: 6,
        moveSpeed: 340,
        turnSpeed: 5,
        lungeExtend: 24,
        lungeSpeed: 240,
        retractPull: 14,
        moveAccel: 40, // x moveSpeed per second: how fast velocity follows input
        turnAccel: 60, // x turnSpeed per second: how fast spin follows input
        color: '#3ee6ff',
        name: 'Fighter',
        kind: 'player',
      },
      opts,
    );
    this.vx = 0; // commanded velocity (before wall push-out)
    this.vy = 0;
    this.svx = 0; // actual velocity this step (after wall push-out)
    this.svy = 0;
    this.omega = 0; // angular velocity, rad/s
    this.paddleOffset = this.paddleBase;
    this.paddleVel = 0; // outward paddle speed along the facing direction
    this.lungeState = 'idle'; // idle | out | back
    this.lungeCooldown = 0;
    this.hitFlash = 0;
    this.invuln = 0;
    this.frozen = 0; // seconds left of an ice freeze (no movement, no turning)
    this.iceImmune = false; // true until the fighter steps off the ice after thawing
    this.prevX = this.x;
    this.prevY = this.y;
  }

  facing() {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  /** World-space paddle segment (a -> b) plus its centre. */
  paddleSegment() {
    const f = this.facing();
    const cx = this.x + f.x * this.paddleOffset;
    const cy = this.y + f.y * this.paddleOffset;
    const px = -f.y;
    const py = f.x;
    const h = this.paddleWidth / 2;
    return {
      ax: cx - px * h,
      ay: cy - py * h,
      bx: cx + px * h,
      by: cy + py * h,
      cx,
      cy,
    };
  }

  /**
   * Velocity of the paddle surface at world point (px, py):
   * body translation + rotation (omega x r) + lunge/retract thrust.
   * This is what makes a rotating or thrusting paddle "whack" the ball.
   */
  surfaceVelocityAt(px, py) {
    const rx = px - this.x;
    const ry = py - this.y;
    const f = this.facing();
    return {
      x: this.svx - this.omega * ry + f.x * this.paddleVel,
      y: this.svy + this.omega * rx + f.y * this.paddleVel,
    };
  }

  /**
   * Advance one physics step from an intent:
   * { mx, my } movement direction (-1..1), turn (-1..1), lunge (bool), retract (bool)
   */
  update(dt, intent) {
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.frozen > 0) {
      this.frozen = Math.max(0, this.frozen - dt);
      intent = { mx: 0, my: 0, turn: 0, lunge: false, retract: false };
    }

    // Movement with a short acceleration ramp for a weighty feel.
    let mx = intent.mx || 0;
    let my = intent.my || 0;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    const accel = this.moveSpeed * this.moveAccel;
    this.vx = approach(this.vx, mx * this.moveSpeed, accel * dt);
    this.vy = approach(this.vy, my * this.moveSpeed, accel * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Rotation. omega is what the paddle's tips inherit as surface velocity.
    const targetOmega = clamp(intent.turn || 0, -1, 1) * this.turnSpeed;
    this.omega = approach(this.omega, targetOmega, this.turnSpeed * this.turnAccel * dt);
    this.angle = wrapAngle(this.angle + this.omega * dt);

    // Paddle thrust: W lunges outward, S pulls the paddle in.
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);
    if (intent.lunge && this.lungeState === 'idle' && this.lungeCooldown === 0) {
      this.lungeState = 'out';
    }
    let target = this.paddleBase;
    let rate = this.lungeSpeed * 0.5;
    if (this.lungeState === 'out') {
      target = this.paddleBase + this.lungeExtend;
      rate = this.lungeSpeed;
      if (this.paddleOffset >= target - 1e-3) this.lungeState = 'back';
    } else if (this.lungeState === 'back') {
      target = this.paddleBase;
      rate = this.lungeSpeed * 0.45;
      if (this.paddleOffset <= target + 1e-3) {
        this.lungeState = 'idle';
        this.lungeCooldown = 0.12;
      }
    } else if (intent.retract) {
      target = this.paddleBase - this.retractPull;
      rate = this.lungeSpeed * 0.8;
    }
    const prevOffset = this.paddleOffset;
    this.paddleOffset = approach(prevOffset, target, rate * dt);
    this.paddleVel = (this.paddleOffset - prevOffset) / dt;

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
  }

  /** Call after wall push-out so surface velocity reflects real motion. */
  finalizeStep(dt) {
    this.svx = (this.x - this.prevX) / dt;
    this.svy = (this.y - this.prevY) / dt;
  }
}

export class Boss extends Fighter {
  constructor(opts = {}) {
    super({
      kind: 'boss',
      color: '#ff7a3d',
      reaction: 0.35, // seconds of perception delay + replanning period
      aggression: 0.25, // probability of a whack when the ball arrives
      aim: 0.5, // 0 = just block, 1 = angle the paddle to return the ball at the player
      absorb: 0.5, // probability of pulling the shield back to slow a fast ball
      absorbSpeed: 600, // px/s above which the boss considers absorbing
      threatRadius: 320, // how close a predicted path must pass to be reacted to
      blockRadius: 90, // a path passing this close is one the boss must block
      safeRadius: 260, // returns that rebound closer than this to the boss are avoided
      leash: 260, // how far from home the boss will roam
      ...opts,
    });
    this.home = { x: this.x, y: this.y };
    this.ai = { timer: 0, tx: this.x, ty: this.y, targetAngle: this.angle, lunge: false, absorb: false, arrival: -1 };
    // Optional patrol: the home position travels around an ellipse.
    if (this.orbit) {
      this.orbitPhase = this.orbit.phase || 0;
      this.updateOrbit(0);
    }
    // Optional signal pulse ability.
    this.pulser = this.pulse ? new Pulser(this.pulse) : null;
  }

  /** Advance the patrol orbit (if any); the AI steers toward `home`. */
  updateOrbit(dt) {
    const o = this.orbit;
    if (!o) return;
    this.orbitPhase = wrapAngle(this.orbitPhase + o.omega * dt);
    this.home.x = o.cx + Math.cos(this.orbitPhase) * o.rx;
    this.home.y = o.cy + Math.sin(this.orbitPhase) * o.ry;
  }

  /** Where the patrol home will be `t` seconds from now. */
  homeAt(t) {
    const o = this.orbit;
    if (!o) return this.home;
    const ph = this.orbitPhase + o.omega * t;
    return { x: o.cx + Math.cos(ph) * o.rx, y: o.cy + Math.sin(ph) * o.ry };
  }
}

/**
 * A rotating bar obstacle. It is a moving surface, so its tips add or remove
 * ball speed exactly like a swinging paddle.
 */
export class Spinner {
  constructor({ x, y, length, thick = 8, omega = 0.6, angle = 0 }) {
    this.x = x;
    this.y = y;
    this.halfLen = length / 2;
    this.reach = this.halfLen; // radius of the area it can occupy
    this.thick = thick;
    this.omega = omega;
    this.angle = angle;
    this.kind = 'spinner';
  }

  update(dt) {
    this.angle = wrapAngle(this.angle + this.omega * dt);
  }

  segmentsAt(angle) {
    const c = Math.cos(angle) * this.halfLen;
    const s = Math.sin(angle) * this.halfLen;
    return [{ ax: this.x - c, ay: this.y - s, bx: this.x + c, by: this.y + s }];
  }

  segments() {
    return this.segmentsAt(this.angle);
  }

  /** Where the bar will be `t` seconds from now. */
  predictSegments(t) {
    return this.segmentsAt(this.angle + this.omega * t);
  }

  surfaceVelocityAt(px, py) {
    const rx = px - this.x;
    const ry = py - this.y;
    return { x: -this.omega * ry, y: this.omega * rx };
  }
}

/**
 * A slab that slides back and forth along an axis (a "breathing" piston).
 * (x, y) is the slab centre when fully retracted; it extends up to `amp`
 * along `axisAngle`, following a smooth cosine cycle of `period` seconds.
 * Moving surface: a slab sliding toward the ball speeds it up.
 */
export class Piston {
  constructor({ x, y, length, thick = 8, axisAngle = 0, amp = 50, period = 5, phase = 0, parallel = false }) {
    this.baseX = x;
    this.baseY = y;
    this.halfLen = length / 2;
    this.thick = thick;
    this.ax = Math.cos(axisAngle);
    this.ay = Math.sin(axisAngle);
    this.amp = amp;
    this.period = period;
    this.phase = phase;
    this.parallel = parallel; // true: the slab lies along the axis (a sliding door)
    this.t = 0;
    this.kind = 'piston';
    // Centre of the swept area and how far the slab can reach from it.
    this.x = x + this.ax * amp * 0.5;
    this.y = y + this.ay * amp * 0.5;
    this.reach = this.halfLen + amp * 0.5;
  }

  offsetAt(t) {
    return this.amp * (0.5 - 0.5 * Math.cos((TAU * t) / this.period + this.phase));
  }

  velocityAt(t) {
    return this.amp * 0.5 * (TAU / this.period) * Math.sin((TAU * t) / this.period + this.phase);
  }

  update(dt) {
    this.t += dt;
  }

  segmentsAt(t) {
    const off = this.offsetAt(t);
    const cx = this.baseX + this.ax * off;
    const cy = this.baseY + this.ay * off;
    // Slab lies perpendicular to the sliding axis (piston) or along it (door).
    const px = this.parallel ? this.ax * this.halfLen : -this.ay * this.halfLen;
    const py = this.parallel ? this.ay * this.halfLen : this.ax * this.halfLen;
    return [{ ax: cx - px, ay: cy - py, bx: cx + px, by: cy + py }];
  }

  segments() {
    return this.segmentsAt(this.t);
  }

  predictSegments(dt) {
    return this.segmentsAt(this.t + dt);
  }

  surfaceVelocityAt() {
    const v = this.velocityAt(this.t);
    return { x: this.ax * v, y: this.ay * v };
  }
}

/**
 * A ring of short bars orbiting a centre, rigidly rotating about it (each bar
 * stays tangent to its orbit). Surface velocity is omega x r about the centre.
 */
export class Orbiter {
  constructor({ x, y, radius, count = 4, length = 90, thick = 8, omega = 0.5, angle = 0 }) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.count = count;
    this.halfLen = length / 2;
    this.thick = thick;
    this.omega = omega;
    this.angle = angle;
    this.reach = radius + this.halfLen;
    this.kind = 'orbiter';
  }

  update(dt) {
    this.angle = wrapAngle(this.angle + this.omega * dt);
  }

  segmentsAt(angle) {
    const segs = [];
    for (let i = 0; i < this.count; i++) {
      const a = angle + (i * TAU) / this.count;
      const cx = this.x + Math.cos(a) * this.radius;
      const cy = this.y + Math.sin(a) * this.radius;
      // Tangent direction.
      const tx = -Math.sin(a) * this.halfLen;
      const ty = Math.cos(a) * this.halfLen;
      segs.push({ ax: cx - tx, ay: cy - ty, bx: cx + tx, by: cy + ty });
    }
    return segs;
  }

  segments() {
    return this.segmentsAt(this.angle);
  }

  predictSegments(t) {
    return this.segmentsAt(this.angle + this.omega * t);
  }

  surfaceVelocityAt(px, py) {
    const rx = px - this.x;
    const ry = py - this.y;
    return { x: -this.omega * ry, y: this.omega * rx };
  }
}

/**
 * A signal pulse: every `period` seconds an expanding ring is emitted from
 * the source position. The ring is a moving surface travelling outward at
 * `speed`, so it flings the ball away from the source and boosts a ball it
 * overtakes. It fades out at `maxRadius`.
 */
export class Pulser {
  constructor({ period = 5, speed = 340, maxRadius = 330, thick = 8, warn = 0.8, delay = 2 }) {
    this.period = period;
    this.speed = speed;
    this.maxRadius = maxRadius;
    this.thick = thick;
    this.warn = warn;
    this.t = 0;
    this.nextAt = delay;
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.radius = 0;
    this.reach = 0; // no static footprint for the boss brain to avoid
    this.kind = 'pulse';
    this.emitted = false; // set true on the step a pulse is emitted (consumed by the game)
  }

  /** Seconds until the next pulse; below `warn` the source should telegraph. */
  countdown() {
    return this.nextAt - this.t;
  }

  update(dt, sx, sy) {
    this.t += dt;
    this.emitted = false;
    if (this.active) {
      this.radius += this.speed * dt;
      if (this.radius >= this.maxRadius) this.active = false;
    }
    if (this.t >= this.nextAt) {
      this.nextAt += this.period;
      this.active = true;
      this.radius = 1;
      this.x = sx;
      this.y = sy;
      this.emitted = true;
    }
  }

  /** The ring right now, or null when there is none. */
  ring() {
    return this.active ? { x: this.x, y: this.y, r: this.radius, thick: this.thick } : null;
  }

  segments() {
    return [];
  }

  predictSegments() {
    return [];
  }

  surfaceVelocityAt(px, py) {
    const dx = px - this.x;
    const dy = py - this.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * this.speed, y: (dy / d) * this.speed };
  }
}

export function createMover(def) {
  if (def.type === 'piston') return new Piston(def);
  if (def.type === 'orbiter') return new Orbiter(def);
  return new Spinner(def);
}

export { TAU };
