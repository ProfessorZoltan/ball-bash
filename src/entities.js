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
    this.lastHitBy = null; // 'player' | 'boss' | 'wall'
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
    this.thick = thick;
    this.omega = omega;
    this.angle = angle;
    this.kind = 'spinner';
  }

  update(dt) {
    this.angle = wrapAngle(this.angle + this.omega * dt);
  }

  segments() {
    const c = Math.cos(this.angle) * this.halfLen;
    const s = Math.sin(this.angle) * this.halfLen;
    return [{ ax: this.x - c, ay: this.y - s, bx: this.x + c, by: this.y + s }];
  }

  surfaceVelocityAt(px, py) {
    const rx = px - this.x;
    const ry = py - this.y;
    return { x: -this.omega * ry, y: this.omega * rx };
  }
}

export { TAU };
