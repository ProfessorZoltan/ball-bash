// Boss brain. The boss perceives the ball with a delay (its reaction time),
// re-plans once per reaction period, and then steers toward the plan with the
// same movement/turn limits the player has.
//
// Planning has three parts:
//  1. Threat: predict the ball's path (with wall bounces) and find where it
//     will pass closest to the boss, even if it is currently moving away and
//     will rebound off a wall behind.
//  2. Return: search candidate return directions and pick the one whose
//     predicted path travels through open space toward the player and never
//     rebounds back at the boss. The paddle angle is then the bisector between
//     "where the ball comes from" and that chosen direction.
//  3. Receive: whack (lunge), absorb (pull the shield back) or just block.
import { closestPointOnSegment, predictPath } from './physics.js';
import { angleDiff, clamp } from './vec.js';

const DEG = Math.PI / 180;

/** Ring buffer of ball snapshots so the boss can look into the past. */
export class BallHistory {
  constructor(maxSeconds = 2.5) {
    this.maxSeconds = maxSeconds;
    this.items = [];
    this.ballRadius = 11;
  }

  reset() {
    this.items.length = 0;
  }

  push(t, ball) {
    this.ballRadius = ball.r;
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

/**
 * Find where the predicted ball path passes closest to the boss.
 * Prefers the first leg that actually reaches the boss's block radius;
 * otherwise the closest approach of any leg.
 */
function findThreat(boss, seen, walls, ballR) {
  const path = predictPath(seen.x, seen.y, seen.vx, seen.vy, walls, 3, 3200, ballR);
  let closest = null;
  let travelled = 0;
  for (let li = 0; li < path.length; li++) {
    const seg = path[li];
    const segLen = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    const c = closestPointOnSegment(boss.x, boss.y, seg.ax, seg.ay, seg.bx, seg.by);
    const along = travelled + c.t * segLen;
    travelled += segLen;
    // On the first leg the ball is at t=0 right now; if that is the closest
    // point it is moving away, so ignore it.
    if (li === 0 && along < 30) continue;
    const dd = Math.hypot(c.x - boss.x, c.y - boss.y);
    const cand = { x: c.x, y: c.y, dd, seg, along, li };
    if (dd < boss.blockRadius) return cand; // earliest leg that will hit us
    if (!closest || dd < closest.dd) closest = cand;
  }
  return closest;
}

/**
 * Pick the paddle angle that returns the ball along the best lane.
 * (tx, ty) is where the boss will stand; `incoming` is the direction (angle)
 * from that point toward where the ball comes from.
 */
function chooseReturnAngle(boss, tx, ty, incoming, player, walls, eta, ballR, movers = []) {
  const inx = Math.cos(incoming);
  const iny = Math.sin(incoming);
  // Contact happens at the paddle, out in front of the body.
  const cx = tx + inx * boss.paddleBase;
  const cy = ty + iny * boss.paddleBase;
  // The ball travels through the body centre. Tilting the paddle by theta
  // moves the crossing point paddleBase * tan(theta) along the paddle, so
  // beyond a certain tilt the ball misses the paddle and hits the body.
  const reach = boss.paddleWidth / 2 - ballR - 22;
  const maxTilt = Math.max(10 * DEG, Math.atan2(reach, boss.paddleBase) - 4 * DEG);
  const maxK = Math.floor((2 * maxTilt) / (10 * DEG)); // out-angle = 2 * tilt
  let best = null;
  for (let k = -maxK; k <= maxK; k++) {
    const outA = incoming + k * 10 * DEG;
    const dx = Math.cos(outA);
    const dy = Math.sin(outA);
    // Paddle normal is the bisector of "back toward the ball" and "out".
    const nx = inx + dx;
    const ny = iny + dy;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-6) continue;
    const nAngle = Math.atan2(ny / nl, nx / nl);

    const path = predictPath(cx, cy, dx, dy, walls, 2, 2400, ballR);
    if (path.length === 0) continue;
    let score = 0;

    // Safety: after the first bounce, how close does the ball come back to us?
    let dmin = Infinity;
    for (let i = 1; i < path.length; i++) {
      const s = path[i];
      const c = closestPointOnSegment(tx, ty, s.ax, s.ay, s.bx, s.by);
      dmin = Math.min(dmin, Math.hypot(c.x - tx, c.y - ty));
    }
    if (dmin < boss.safeRadius) score -= 900 * (1 - dmin / boss.safeRadius) + 250;

    // Open space: a long first leg means nothing is in the way.
    const first = path[0];
    const len1 = Math.hypot(first.bx - first.ax, first.by - first.ay);
    score += Math.min(len1, 700) * 0.12;

    // Moving obstacles scramble the ball unpredictably: steer clear of them.
    for (const m of movers) {
      for (const s of path) {
        const c = closestPointOnSegment(m.x, m.y, s.ax, s.ay, s.bx, s.by);
        if (Math.hypot(c.x - m.x, c.y - m.y) < m.reach + ballR + 20) {
          score -= 320;
          break;
        }
      }
    }

    // Target: how close the path passes to the player (any leg).
    let dp = Infinity;
    let dpFirst = Infinity;
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      const c = closestPointOnSegment(player.x, player.y, s.ax, s.ay, s.bx, s.by);
      const dd = Math.hypot(c.x - player.x, c.y - player.y);
      if (dd < dp) dp = dd;
      if (i === 0) dpFirst = dd;
    }
    score -= dp * (0.35 + 0.9 * boss.aim);
    if (dpFirst < 90) score += 120; // clean, direct lane

    // Feasibility: can we rotate to that angle before the ball arrives?
    const turnTime = Math.abs(angleDiff(boss.angle, nAngle)) / boss.turnSpeed;
    if (turnTime > eta + 0.05) score -= (turnTime - eta) * 1500;

    if (!best || score > best.score) best = { score, nAngle };
  }
  return best ? best.nAngle : incoming;
}

/**
 * Moving obstacles as segments, frozen at the angle they will have when the
 * ball (currently at x, y moving at `speed`) reaches them, `delay` seconds
 * from now. Good enough for a slow spinner and a fast ball.
 */
function moverSegmentsAt(movers, x, y, speed, delay) {
  const segs = [];
  for (const m of movers) {
    const dist = Math.max(0, Math.hypot(m.x - x, m.y - y) - m.reach);
    const t = delay + (speed > 1 ? dist / speed : 0);
    for (const sg of m.predictSegments(t)) segs.push({ ...sg, kind: 'mover' });
  }
  return segs;
}

function plan(boss, seen, player, walls, now, ballR, movers) {
  const ai = boss.ai;
  const speed = Math.sqrt(seen.vx * seen.vx + seen.vy * seen.vy);
  let faceAngle = Math.atan2(seen.y - boss.y, seen.x - boss.x);
  let tx = boss.home.x;
  let ty = boss.home.y;
  ai.lunge = false;
  ai.absorb = false;
  ai.arrival = -1;

  if (speed > 1) {
    // The snapshot is `reaction` old, so the ball reaches things that much sooner.
    const seenAge = now - (seen.t ?? now);
    const segsIn = movers.length ? walls.concat(moverSegmentsAt(movers, seen.x, seen.y, speed, -seenAge)) : walls;
    const threat = findThreat(boss, seen, segsIn, ballR);
    if (threat && threat.dd < boss.threatRadius) {
      // Stand on the predicted path so the paddle is centred on it.
      tx = threat.x;
      ty = threat.y;
      const incoming = Math.atan2(-threat.seg.dy, -threat.seg.dx);
      // The snapshot is `reaction` seconds old: the ball is closer than it looks.
      const seenAt = seen.t ?? now;
      const eta = Math.max(0, seenAt + threat.along / speed - now);
      ai.arrival = now + eta;
      const segsOut = movers.length ? walls.concat(moverSegmentsAt(movers, tx, ty, speed, eta)) : walls;
      faceAngle = chooseReturnAngle(boss, tx, ty, incoming, player, segsOut, eta, ballR, movers);
      // Decide how to receive it: whack (add speed), absorb (pull the shield
      // back to bleed speed off a hot ball), or just block.
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
  // Remember the ball direction this plan assumed, so a bounce can trigger a
  // fresh plan as soon as it is perceived instead of at the next timer tick.
  ai.planVx = speed > 1 ? seen.vx / speed : 0;
  ai.planVy = speed > 1 ? seen.vy / speed : 0;
}

/**
 * Produce a movement intent for the boss this physics step.
 */
export function bossIntent(boss, history, player, walls, dt, now, movers = []) {
  const ai = boss.ai;
  ai.timer -= dt;
  const seen = history.sample(now - boss.reaction) || history.latest();
  let replan = ai.timer <= 0;
  if (!replan && seen && ai.planVx !== undefined) {
    // Perceived direction changed (a bounce): react now rather than later.
    const sp = Math.hypot(seen.vx, seen.vy);
    if (sp > 1) {
      const dot = (seen.vx / sp) * ai.planVx + (seen.vy / sp) * ai.planVy;
      if (dot < 0.9) replan = true;
    }
  }
  if (replan) {
    ai.timer = boss.reaction;
    if (seen) plan(boss, seen, player, walls, now, history.ballRadius, movers);
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
