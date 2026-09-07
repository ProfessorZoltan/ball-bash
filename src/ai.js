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
//  4. Anticipate: while the ball is still on its way to the player, read the
//     player's shield (pose, and with `swing` its motion at contact), reflect
//     the ball off it the way the physics will, and start moving toward where
//     that return will pass. How far the boss commits to the read, whether it
//     reads the swing, and how accurately, are per-boss `anticipation` params.
import { closestPointOnSegment, predictPath, raycastSegments, reflect } from './physics.js';
import { angleDiff, clamp } from './vec.js';
import { BALL, SURFACE_VELOCITY_FACTOR } from './config.js';

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
function findThreat(boss, seen, walls, ballR, refX = boss.x, refY = boss.y) {
  const path = predictPath(seen.x, seen.y, seen.vx, seen.vy, walls, 3, 3200, ballR);
  let closest = null;
  let travelled = 0;
  for (let li = 0; li < path.length; li++) {
    const seg = path[li];
    const segLen = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
    const c = closestPointOnSegment(refX, refY, seg.ax, seg.ay, seg.bx, seg.by);
    const along = travelled + c.t * segLen;
    travelled += segLen;
    // On the first leg the ball is at t=0 right now; if that is the closest
    // point it is moving away, so ignore it.
    if (li === 0 && along < 30) continue;
    const dd = Math.hypot(c.x - refX, c.y - refY);
    const cand = { x: c.x, y: c.y, dd, seg, along, li };
    if (dd < boss.blockRadius) return cand; // earliest leg that will hit us
    if (!closest || dd < closest.dd) closest = cand;
  }
  return closest;
}

/** The paddle segment a fighter would present at a given pose. */
function paddleSegmentAt(f, pose) {
  const fx = Math.cos(pose.angle);
  const fy = Math.sin(pose.angle);
  const cx = pose.x + fx * pose.offset;
  const cy = pose.y + fy * pose.offset;
  const h = f.paddleWidth / 2;
  return { ax: cx + fy * h, ay: cy - fx * h, bx: cx - fy * h, by: cy + fx * h, cx, cy, fx, fy };
}

/**
 * Anticipation: predict the ball's state just after the player's shield
 * returns it. `seen` is the (delayed) ball snapshot; `segs` the walls and
 * timed movers it will bounce off before reaching the player.
 *   swing  read the player's motion: extrapolate the pose to contact time and
 *          give the shield its surface velocity (a moving shield adds speed
 *          and changes the angle, exactly as the physics does)
 *   error  degrees of read error, applied as a random skew per plan
 * Returns { x, y, vx, vy, t } for the moment after contact, or null when the
 * ball will not meet the shield (then the boss falls back to waiting).
 */
export function predictReturn(seen, now, player, segs, ballR, { swing = true, error = 0 } = {}, diag = null) {
  const why = (reason) => {
    if (diag) diag.reason = reason;
    return null;
  };
  const speed = Math.hypot(seen.vx, seen.vy);
  if (speed < 1) return why('still');
  const seenAt = seen.t ?? now;
  const path = predictPath(seen.x, seen.y, seen.vx, seen.vy, segs, 4, 3200, ballR);
  if (!path.length) return why('no-path');

  // First crossing of the ball's path with the shield presented at `pose`.
  const contactAt = (pose) => {
    const seg = paddleSegmentAt(player, pose);
    const bodyR = player.r + ballR;
    let travelled = 0;
    for (const leg of path) {
      const len = Math.hypot(leg.bx - leg.ax, leg.by - leg.ay);
      // Only the shield's face returns the ball; from behind, the body is in the way.
      const facing = seg.fx * leg.dx + seg.fy * leg.dy < -0.05;
      const hit = facing ? raycastSegments(leg.ax, leg.ay, leg.dx, leg.dy, [seg], len) : null;
      // A ball that reaches the body first is not returned at all.
      const near = closestPointOnSegment(pose.x, pose.y, leg.ax, leg.ay, leg.bx, leg.by);
      if (Math.hypot(near.x - pose.x, near.y - pose.y) < bodyR && (!hit || near.t * len < hit.t)) return { body: true };
      if (hit) {
        // The ball's edge, not its centre, meets the shield's face.
        const cosI = Math.abs(hit.nx * leg.dx + hit.ny * leg.dy) || 1;
        const t = Math.max(0, hit.t - (player.paddleThick / 2 + ballR) / cosI);
        const dist = travelled + t;
        return { x: leg.ax + leg.dx * t, y: leg.ay + leg.dy * t, dx: leg.dx, dy: leg.dy, nx: hit.nx, ny: hit.ny, time: Math.max(0, seenAt + dist / speed - now), seg };
      }
      travelled += len;
    }
    return null;
  };

  let pose = { x: player.x, y: player.y, angle: player.angle, offset: player.paddleOffset };
  let c = contactAt(pose);
  if (!c) return why('miss');
  if (c.body) return why('body');
  let svx = 0;
  let svy = 0;
  if (swing) {
    // Where will the shield be when the ball gets there? Body velocity,
    // rotation, and a thrust in progress all move it.
    const tc = c.time;
    const thrusting = player.lungeState === 'out' && tc < 0.12;
    pose = {
      x: player.x + player.svx * tc,
      y: player.y + player.svy * tc,
      angle: player.angle + player.omega * tc,
      offset: thrusting ? player.paddleBase + player.lungeExtend : player.paddleBase,
    };
    const c2 = contactAt(pose);
    if (!c2) return why('swing-miss'); // the swing takes the shield off the ball's path
    if (c2.body) return why('swing-body');
    c = c2;
    const seg = paddleSegmentAt(player, pose);
    const rx = c.x - pose.x;
    const ry = c.y - pose.y;
    const thrust = thrusting ? player.paddleVel : 0;
    svx = player.svx - player.omega * ry + seg.fx * thrust;
    svy = player.svy + player.omega * rx + seg.fy * thrust;
  }

  const out = { vx: c.dx * speed, vy: c.dy * speed };
  if (!reflect(out, c.nx, c.ny, svx, svy, 1, SURFACE_VELOCITY_FACTOR)) return why('receding');
  let os = Math.hypot(out.vx, out.vy);
  if (os < 1e-6) return why('dead');
  if (diag) diag.reason = 'ok';
  const clamped = clamp(os, BALL.minSpeed, BALL.maxSpeed);
  out.vx *= clamped / os;
  out.vy *= clamped / os;
  if (error > 0) {
    const skew = (Math.random() * 2 - 1) * error * DEG;
    const cs = Math.cos(skew);
    const sn = Math.sin(skew);
    const vx = out.vx * cs - out.vy * sn;
    const vy = out.vx * sn + out.vy * cs;
    out.vx = vx;
    out.vy = vy;
  }
  return { x: c.x, y: c.y, vx: out.vx, vy: out.vy, t: now + c.time };
}

/**
 * Pick the paddle angle that returns the ball along the best lane.
 * (tx, ty) is where the boss will stand; `incoming` is the direction (angle)
 * from that point toward where the ball comes from.
 */
function chooseReturnAngle(boss, tx, ty, incoming, player, walls, eta, ballR, movers = []) {
  const humans = Array.isArray(player) ? player : [player];
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

    // Target: how close the path passes to a human (any leg, whichever human is nearest).
    let dp = Infinity;
    let dpFirst = Infinity;
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      for (const h of humans) {
        const c = closestPointOnSegment(h.x, h.y, s.ax, s.ay, s.bx, s.by);
        const dd = Math.hypot(c.x - h.x, c.y - h.y);
        if (dd < dp) dp = dd;
        if (i === 0 && dd < dpFirst) dpFirst = dd;
      }
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
 * Moving obstacles as segments, frozen where they will be when the ball
 * (at x, y moving with velocity vx, vy) reaches them, `delay` seconds from
 * now. The arrival time comes from a ray cast against the mover's current
 * segments; when the ray misses (or no direction is given) it falls back to
 * the distance to the mover's footprint.
 */
export function moverSegmentsAt(movers, x, y, vx, vy, delay = 0) {
  const speed = Math.hypot(vx, vy);
  const segs = [];
  for (const m of movers) {
    let t = delay;
    if (speed > 1) {
      const hit = raycastSegments(x, y, vx / speed, vy / speed, m.segments(), 4000);
      if (hit) t += hit.t / speed;
      else t += Math.max(0, Math.hypot(m.x - x, m.y - y) - m.reach) / speed;
    }
    for (const sg of m.predictSegments(t)) segs.push({ ...sg, kind: 'mover' });
  }
  return segs;
}

/** Of several humans, the one the ball is heading for (or, failing that, the nearest to it). */
function pickTarget(humans, seen) {
  let best = null;
  let bestScore = -Infinity;
  const sp = Math.hypot(seen.vx, seen.vy) || 1;
  for (const h of humans) {
    const dx = h.x - seen.x;
    const dy = h.y - seen.y;
    const d = Math.hypot(dx, dy) || 1;
    const toward = (dx * seen.vx + dy * seen.vy) / (d * sp); // -1..1
    const score = toward * 1000 - d * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

function plan(boss, seen, humans, walls, now, ballR, movers) {
  const ai = boss.ai;
  const player = pickTarget(humans, seen) || humans[0];
  const speed = Math.sqrt(seen.vx * seen.vx + seen.vy * seen.vy);
  // Idle facing: the ball, unless it is on the opponent's side of the arena
  // and heading their way, in which case the next shot comes from them.
  const ballToPlayer = Math.hypot(seen.x - player.x, seen.y - player.y);
  const ballToBoss = Math.hypot(seen.x - boss.x, seen.y - boss.y);
  const headingToPlayer = (player.x - seen.x) * seen.vx + (player.y - seen.y) * seen.vy > 0;
  let faceAngle =
    ballToPlayer < ballToBoss && headingToPlayer
      ? Math.atan2(player.y - boss.y, player.x - boss.x)
      : Math.atan2(seen.y - boss.y, seen.x - boss.x);
  let tx = boss.home.x;
  let ty = boss.home.y;
  ai.lunge = false;
  ai.absorb = false;
  ai.arrival = -1;
  ai.anticipating = false;

  if (speed > 1) {
    // The snapshot is `reaction` old, so the ball reaches things that much sooner.
    const seenAge = now - (seen.t ?? now);
    const segsIn = movers.length ? walls.concat(moverSegmentsAt(movers, seen.x, seen.y, seen.vx, seen.vy, -seenAge)) : walls;
    let threat = findThreat(boss, seen, segsIn, ballR);
    if (threat && boss.orbit) {
      // Patrolling boss: keep moving and intercept the ball where its path
      // passes closest to where the patrol will be when it arrives.
      const eta0 = Math.max(0, (seen.t ?? now) + threat.along / speed - now);
      const fut = boss.homeAt(eta0);
      threat = findThreat(boss, seen, segsIn, ballR, fut.x, fut.y);
    }
    // Read the player's shield. If the ball meets it before the pass-through
    // path ever threatens us, the path beyond that contact is fiction and the
    // read is what to plan for.
    const ant = boss.anticipation;
    const diag = {};
    // Read every human shield the ball could meet; the earliest contact is the return that happens.
    let ret = null;
    if (ant && ant.commit > 0) {
      for (const h of humans) {
        const d = {};
        const r = predictReturn(seen, now, h, segsIn, ballR, ant, d);
        if (r && (!ret || r.t < ret.t)) {
          ret = r;
          diag.reason = d.reason;
        } else if (!ret) diag.reason = d.reason;
      }
    }
    ai.readReason = diag.reason || 'off';
    if (ret && threat) {
      const contactDist = (ret.t - (seen.t ?? now)) * speed;
      if (threat.along > contactDist - 1) threat = null;
    }
    if (threat && threat.dd < boss.threatRadius) {
      // Stand on the predicted path so the paddle is centred on it.
      tx = threat.x;
      ty = threat.y;
      const incoming = Math.atan2(-threat.seg.dy, -threat.seg.dx);
      // The snapshot is `reaction` seconds old: the ball is closer than it looks.
      const seenAt = seen.t ?? now;
      const eta = Math.max(0, seenAt + threat.along / speed - now);
      ai.arrival = now + eta;
      const segsOut = movers.length ? walls.concat(moverSegmentsAt(movers, tx, ty, 0, 0, eta)) : walls;
      faceAngle = chooseReturnAngle(boss, tx, ty, incoming, humans, segsOut, eta, ballR, movers);
      // Decide how to receive it: whack (add speed), absorb (pull the shield
      // back to bleed speed off a hot ball), or just block.
      if (eta < 0.28 && Math.random() < boss.aggression) ai.lunge = true;
      else if (speed > boss.absorbSpeed && Math.random() < boss.absorb) ai.absorb = true;
    } else if (ret) {
      // Nothing coming yet: pre-position for the return the shield would
      // produce. The real return still triggers a re-plan.
      {
        const retSpeed = Math.hypot(ret.vx, ret.vy);
        const segsRet = movers.length ? walls.concat(moverSegmentsAt(movers, ret.x, ret.y, ret.vx, ret.vy, ret.t - now)) : walls;
        let guess = findThreat(boss, ret, segsRet, ballR);
        if (guess && boss.orbit) {
          const eta0 = Math.max(0, ret.t + guess.along / retSpeed - now);
          const fut = boss.homeAt(eta0);
          guess = findThreat(boss, ret, segsRet, ballR, fut.x, fut.y);
        }
        if (guess && guess.dd < boss.threatRadius) {
          const eta = Math.max(0, ret.t + guess.along / retSpeed - now);
          const anchor = boss.orbit ? boss.homeAt(eta) : boss.home;
          // Commit: how far from the neutral spot toward the read the boss goes.
          tx = anchor.x + (guess.x - anchor.x) * ant.commit;
          ty = anchor.y + (guess.y - anchor.y) * ant.commit;
          const incoming = Math.atan2(-guess.seg.dy, -guess.seg.dx);
          const segsOut = movers.length ? walls.concat(moverSegmentsAt(movers, tx, ty, 0, 0, eta)) : walls;
          faceAngle = ant.commit >= 0.5 ? chooseReturnAngle(boss, tx, ty, incoming, humans, segsOut, eta, ballR, movers) : incoming;
          ai.anticipating = true;
          ai.antRet = ret; // the read, kept so tests and sims can score it against the real return
        }
      }
    }
  }

  // Keep the boss on a leash around its home position (for a patrolling
  // boss, around where the patrol will be at the ball's arrival).
  const anchor = boss.orbit && ai.arrival > 0 ? boss.homeAt(Math.max(0, ai.arrival - now)) : boss.home;
  const hx = tx - anchor.x;
  const hy = ty - anchor.y;
  const hd = Math.hypot(hx, hy);
  if (hd > boss.leash) {
    tx = anchor.x + (hx / hd) * boss.leash;
    ty = anchor.y + (hy / hd) * boss.leash;
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
  const humans = Array.isArray(player) ? player : [player];
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
    if (seen) plan(boss, seen, humans, walls, now, history.ballRadius, movers);
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
    // A patrolling boss keeps rolling through the block; others plant.
    const hold = boss.orbit ? 0.35 : 0.12;
    mx *= hold;
    my *= hold;
  }
  // Absorb: retract the shield as the ball lands so the receding surface
  // slows it down (the same physics as the player's S key).
  const retract = !!ai.absorb && ai.arrival > 0 && remaining < 0.14 && remaining > -0.1;

  const lunge = ai.lunge;
  ai.lunge = false;
  return { mx, my, turn, lunge, retract };
}
