// Boss brain. The boss perceives the ball with a delay (its reaction time),
// re-plans once per reaction period, and then steers toward the plan with the
// same movement/turn limits the player has.
import { closestPointOnSegment, predictPath } from './physics.js';
import { angleDiff, clamp, lerpAngle } from './vec.js';

/** Ring buffer of ball snapshots so the boss can look into the past. */
export class BallHistory {
  constructor(maxSeconds = 2.5) {
    this.maxSeconds = maxSeconds;
    this.items = [];
  }

  reset() {
    this.items.length = 0;
  }

  push(t, ball) {
    this.items.push({ t, x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy });
    const cutoff = t - this.maxSeconds;
    while (this.items.length > 1 && this.items[0].t < cutoff) this.items.shift();
  }

  latest() {
    return this.items[this.items.length - 1] || null;
  }

  /** Newest snapshot taken at or before time `t`. */
  sample(t) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].t <= t) return this.items[i];
    }
    return this.items[0] || null;
  }
}

function plan(boss, seen, player, walls, now) {
  const ai = boss.ai;
  const speed = Math.sqrt(seen.vx * seen.vx + seen.vy * seen.vy);
  let faceAngle = Math.atan2(seen.y - boss.y, seen.x - boss.x);
  let tx = boss.home.x;
  let ty = boss.home.y;
  ai.lunge = false;
  ai.arrival = -1;

  const approaching = (boss.x - seen.x) * seen.vx + (boss.y - seen.y) * seen.vy > 0;
  if (speed > 1 && approaching) {
    const path = predictPath(seen.x, seen.y, seen.vx, seen.vy, walls, 2, 2600);
    let best = null;
    let travelled = 0;
    for (const seg of path) {
      const c = closestPointOnSegment(boss.x, boss.y, seg.ax, seg.ay, seg.bx, seg.by);
      const dd = Math.hypot(c.x - boss.x, c.y - boss.y);
      const along = travelled + Math.hypot(c.x - seg.ax, c.y - seg.ay);
      if (!best || dd < best.dd) best = { x: c.x, y: c.y, dd, seg, along };
      travelled += Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    }
    if (best && best.dd < boss.threatRadius) {
      // Stand on the predicted path so the paddle is centred on it.
      tx = best.x;
      ty = best.y;
      // Face where the ball will come from; optionally angle the paddle so the
      // reflection heads back at the player.
      const incoming = Math.atan2(-best.seg.dy, -best.seg.dx);
      const toPlayer = Math.atan2(player.y - boss.y, player.x - boss.x);
      const bisector = incoming + angleDiff(incoming, toPlayer) / 2;
      faceAngle = lerpAngle(incoming, bisector, boss.aim);
      // Whack when the ball is about to arrive.
      const eta = best.along / speed;
      ai.arrival = now + eta;
      // Decide how to receive it: whack (add speed), absorb (pull the shield
      // back to bleed speed off a hot ball), or just block.
      ai.absorb = false;
      if (eta < 0.28 && Math.random() < boss.aggression) ai.lunge = true;
      else if (speed > boss.absorbSpeed && Math.random() < boss.absorb) ai.absorb = true;
    }
  }

  // Keep the boss on a leash around its home position.
  const hx = tx - boss.home.x;
  const hy = ty - boss.home.y;
  const hd = Math.hypot(hx, hy);
  if (hd > boss.leash) {
    tx = boss.home.x + (hx / hd) * boss.leash;
    ty = boss.home.y + (hy / hd) * boss.leash;
  }
  ai.tx = tx;
  ai.ty = ty;
  ai.targetAngle = faceAngle;
}

/**
 * Produce a movement intent for the boss this physics step.
 */
export function bossIntent(boss, history, player, walls, dt, now) {
  const ai = boss.ai;
  ai.timer -= dt;
  if (ai.timer <= 0) {
    ai.timer = boss.reaction;
    const seen = history.sample(now - boss.reaction) || history.latest();
    if (seen) plan(boss, seen, player, walls, now);
  }

  let mx = ai.tx - boss.x;
  let my = ai.ty - boss.y;
  const d = Math.hypot(mx, my);
  if (d < 3) {
    mx = 0;
    my = 0;
  } else {
    const k = Math.min(1, d / 30) / d; // ease in when close
    mx *= k;
    my *= k;
  }

  const diff = angleDiff(boss.angle, ai.targetAngle);
  let turn = clamp(diff / (boss.turnSpeed * Math.max(dt, 1 / 120)), -1, 1);

  // Brace: hold the shield steady in the last moments before impact so the
  // boss does not accidentally whack the ball into its own walls at speed.
  const remaining = ai.arrival - now;
  const imminent = ai.arrival > 0 && remaining < 0.26 && remaining > -0.08;
  if (imminent) {
    turn *= 0.12;
    mx *= 0.12;
    my *= 0.12;
  }
  // Absorb: retract the shield as the ball lands so the receding surface
  // slows it down (the same physics as the player's S key).
  const retract = !!ai.absorb && ai.arrival > 0 && remaining < 0.14 && remaining > -0.1;

  const lunge = ai.lunge;
  ai.lunge = false;
  return { mx, my, turn, lunge, retract };
}
