// Ball advancement + collision dispatch. Pure (no DOM) so it can be tested
// headlessly and reused by the boss's path prediction if needed.
import { circleVsCapsule, circleVsCircle, capsuleVsCapsule, reflect, ejectFromPolygon, resolveCircleVsSegments } from './physics.js';

/**
 * Move the ball by dt and resolve collisions against static walls and the
 * fighters' paddles and bodies.
 *
 * hooks (all optional):
 *   onWall(hit, segment, before)      static surface bounce; `before` is the
 *                                     velocity the ball had before bouncing
 *   onPaddle(fighter, hit, speedBefore) paddle bounce (surface velocity applied)
 *   onBody(fighter, hit) -> boolean   body contact; return true to stop processing
 *                                     (e.g. boss defeated). Return false to bounce.
 *   onMover(mover, hit, speedBefore)  moving obstacle bounce
 *
 * `movers` are moving obstacles exposing segments(), thick and surfaceVelocityAt().
 * `polygons` are the solid obstacle outlines: if the ball's centre ends up
 * inside one (crushed against it by a mover), it is ejected through the
 * nearest edge and the wall pass runs once more.
 */

export function advanceBall(ball, walls, fighters, dt, factor = 1, hooks = {}, movers = [], polygons = []) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Order matters: fighters are soft (they can be pushed away later), walls
  // and movers are solid, so solid geometry is resolved last and always wins.
  for (let iter = 0; iter < 6; iter++) {
    let any = false;

    for (const f of fighters) {
      const seg = f.paddleSegment();
      const h = circleVsCapsule(ball.x, ball.y, ball.r, seg.ax, seg.ay, seg.bx, seg.by, f.paddleThick, ball.vx, ball.vy);
      if (h) {
        ball.x += h.nx * h.depth;
        ball.y += h.ny * h.depth;
        const sv = f.surfaceVelocityAt(h.cx, h.cy);
        const before = ball.speed;
        if (reflect(ball, h.nx, h.ny, sv.x, sv.y, 1, factor) && hooks.onPaddle) hooks.onPaddle(f, h, before);
        any = true;
      }
      const hb = circleVsCircle(ball.x, ball.y, ball.r, f.x, f.y, f.r);
      if (hb) {
        ball.x += hb.nx * hb.depth;
        ball.y += hb.ny * hb.depth;
        const relN = (ball.vx - f.svx) * hb.nx + (ball.vy - f.svy) * hb.ny;
        if (relN < 0 && hooks.onBody && hooks.onBody(f, hb)) return true;
        reflect(ball, hb.nx, hb.ny, f.svx, f.svy);
        any = true;
      }
    }
    for (const m of movers) {
      if (m.ring) {
        // Expanding ring: a thin circular moving wall.
        const ring = m.ring();
        if (!ring) continue;
        const dx = ball.x - ring.x;
        const dy = ball.y - ring.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const gap = d - ring.r; // signed distance from the ring line
        const reach = ball.r + ring.thick;
        if (Math.abs(gap) >= reach) continue;
        const side = gap >= 0 ? 1 : -1;
        const nx = (side * dx) / d;
        const ny = (side * dy) / d;
        const depth = reach - Math.abs(gap);
        ball.x += nx * depth;
        ball.y += ny * depth;
        const sv = m.surfaceVelocityAt(ball.x, ball.y);
        const before = ball.speed;
        if (reflect(ball, nx, ny, sv.x, sv.y, 1, factor) && hooks.onMover) hooks.onMover(m, { nx, ny, cx: ball.x - nx * ball.r, cy: ball.y - ny * ball.r, depth }, before);
        any = true;
        continue;
      }
      for (const seg of m.segments()) {
        const h = circleVsCapsule(ball.x, ball.y, ball.r, seg.ax, seg.ay, seg.bx, seg.by, m.thick, ball.vx, ball.vy);
        if (!h) continue;
        ball.x += h.nx * h.depth;
        ball.y += h.ny * h.depth;
        const sv = m.surfaceVelocityAt(h.cx, h.cy);
        const before = ball.speed;
        if (reflect(ball, h.nx, h.ny, sv.x, sv.y, 1, factor) && hooks.onMover) hooks.onMover(m, h, before);
        any = true;
      }
    }

    for (const s of walls) {
      if (s.broken) continue; // shattered glass: nothing to hit
      const h = circleVsCapsule(ball.x, ball.y, ball.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, ball.vx, ball.vy);
      if (!h) continue;
      ball.x += h.nx * h.depth;
      ball.y += h.ny * h.depth;
      const pvx = ball.vx;
      const pvy = ball.vy;
      if (reflect(ball, h.nx, h.ny, 0, 0) && hooks.onWall) hooks.onWall(h, s, { vx: pvx, vy: pvy });
      any = true;
    }

    if (!any) break;
  }

  for (const poly of polygons) {
    if (ejectFromPolygon(ball, poly)) {
      for (const s of walls) {
        if (s.broken) continue;
        const h = circleVsCapsule(ball.x, ball.y, ball.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, ball.vx, ball.vy);
        if (h) {
          ball.x += h.nx * h.depth;
          ball.y += h.ny * h.depth;
        }
      }
    }
  }
  return false;
}

/**
 * After the ball has been resolved against solid geometry, push any fighter
 * that still overlaps it away from the ball (body or paddle), so a fighter
 * cannot pin the ball inside a wall.
 */
export function separateFightersFromBall(ball, fighters) {
  for (const f of fighters) {
    const hb = circleVsCircle(ball.x, ball.y, ball.r, f.x, f.y, f.r);
    if (hb) {
      f.x -= hb.nx * hb.depth;
      f.y -= hb.ny * hb.depth;
    }
    const seg = f.paddleSegment();
    const hp = circleVsCapsule(ball.x, ball.y, ball.r, seg.ax, seg.ay, seg.bx, seg.by, f.paddleThick, ball.vx, ball.vy);
    if (hp) {
      f.x -= hp.nx * hp.depth;
      f.y -= hp.ny * hp.depth;
    }
  }
}

// ------------------------------------------------------ fighters vs the world

const SKIN = 0.01; // px of clearance left after a push, so contact does not linger in rounding

/** Every mover's segments, carrying the mover's thickness. */
export function moverSegments(movers) {
  const out = [];
  for (const m of movers) for (const sg of m.segments()) out.push({ ...sg, thick: m.thick });
  return out;
}

/** The deepest overlap between a fighter's shield and any of the segments, or null. */
export function shieldOverlap(f, segs) {
  const seg = f.paddleSegment();
  let best = null;
  for (const s of segs) {
    const h = capsuleVsCapsule(seg.ax, seg.ay, seg.bx, seg.by, f.paddleThick, s.ax, s.ay, s.bx, s.by, s.thick || 0, f.x, f.y);
    if (h && (!best || h.depth > best.depth)) best = h;
  }
  return best;
}

/**
 * Keep a fighter's shield out of walls, glass and movers, so nobody hides
 * behind a wall and strikes through it. Call after the body's own push-out,
 * with prevX/prevY/prevAngle still holding where the step began. A turn that
 * swings the shield into a wall stops at the wall; walking it into a wall
 * pushes the whole fighter back out (and so slides along the wall); a squeeze
 * neither can fix leaves the fighter where the step began. Returns true when
 * anything had to change.
 */
export function resolveShieldVsWalls(f, walls, movers = []) {
  const segs = movers.length ? walls.concat(moverSegments(movers)) : walls;
  let h = shieldOverlap(f, segs);
  if (!h) return false;
  const newAngle = f.angle;
  const turned = newAngle !== f.prevAngle;
  if (turned) {
    f.angle = f.prevAngle;
    if (!shieldOverlap(f, segs)) {
      f.omega = 0; // the turn alone did it: the shield rests against the wall
      return true;
    }
    f.angle = newAngle;
  }
  for (let i = 0; i < 3 && h; i++) {
    f.x += h.nx * (h.depth + SKIN);
    f.y += h.ny * (h.depth + SKIN);
    resolveCircleVsSegments(f, segs);
    h = shieldOverlap(f, segs);
  }
  if (!h) return true;
  if (turned) {
    f.angle = f.prevAngle;
    f.omega = 0;
    if (!shieldOverlap(f, segs)) return true;
  }
  // Squeezed: a gap narrower than the shield, or a mover closing in.
  f.x = f.prevX;
  f.y = f.prevY;
  h = shieldOverlap(f, segs);
  if (h) {
    f.x += h.nx * (h.depth + SKIN);
    f.y += h.ny * (h.depth + SKIN);
    resolveCircleVsSegments(f, segs);
  }
  return true;
}

/**
 * Do two fighters touch, body or shield? Returns the contact point or null.
 * Bodies are kept apart by the separation step, so a hair of slack counts a
 * pressed-together pair as touching.
 */
export function fightersTouch(a, b, slack = 1) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (Math.hypot(dx, dy) < a.r + b.r + slack) {
    const d = Math.hypot(dx, dy) || 1;
    return { x: b.x + (dx / d) * b.r, y: b.y + (dy / d) * b.r, what: 'body' };
  }
  const sa = a.paddleSegment();
  const sb = b.paddleSegment();
  let h = circleVsCapsule(a.x, a.y, a.r + slack, sb.ax, sb.ay, sb.bx, sb.by, b.paddleThick);
  if (h) return { x: h.cx, y: h.cy, what: 'shield' };
  h = circleVsCapsule(b.x, b.y, b.r + slack, sa.ax, sa.ay, sa.bx, sa.by, a.paddleThick);
  if (h) return { x: h.cx, y: h.cy, what: 'shield' };
  h = capsuleVsCapsule(sa.ax, sa.ay, sa.bx, sa.by, a.paddleThick + slack, sb.ax, sb.ay, sb.bx, sb.by, b.paddleThick, a.x, a.y);
  if (h) return { x: h.cx, y: h.cy, what: 'shields' };
  return null;
}
