// Ball advancement + collision dispatch. Pure (no DOM) so it can be tested
// headlessly and reused by the boss's path prediction if needed.
import { circleVsCapsule, circleVsCircle, reflect } from './physics.js';

/**
 * Move the ball by dt and resolve collisions against static walls and the
 * fighters' paddles and bodies.
 *
 * hooks (all optional):
 *   onWall(hit, segment)              static surface bounce
 *   onPaddle(fighter, hit, speedBefore) paddle bounce (surface velocity applied)
 *   onBody(fighter, hit) -> boolean   body contact; return true to stop processing
 *                                     (e.g. boss defeated). Return false to bounce.
 */
export function advanceBall(ball, walls, fighters, dt, factor = 1, hooks = {}) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  for (let iter = 0; iter < 4; iter++) {
    let any = false;

    for (const s of walls) {
      const h = circleVsCapsule(ball.x, ball.y, ball.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, ball.vx, ball.vy);
      if (!h) continue;
      ball.x += h.nx * h.depth;
      ball.y += h.ny * h.depth;
      if (reflect(ball, h.nx, h.ny, 0, 0) && hooks.onWall) hooks.onWall(h, s);
      any = true;
    }

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
    if (!any) break;
  }
  return false;
}
