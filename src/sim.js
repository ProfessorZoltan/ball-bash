// Ball advancement + collision dispatch. Pure (no DOM) so it can be tested
// headlessly and reused by the boss's path prediction if needed.
import { circleVsCapsule, circleVsCircle, reflect } from './physics.js';

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
 */

export function advanceBall(ball, walls, fighters, dt, factor = 1, hooks = {}, movers = []) {
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
