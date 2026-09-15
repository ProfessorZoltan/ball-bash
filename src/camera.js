// The camera: where the screen looks when a level is bigger than it.
//
// Every level before the Outer Course fits the window whole, and most holes
// still do. A hole that does not declares `view`, the size of the window in
// world units, and the renderer scales to that instead of to the level; this
// module says where the window sits over the world each frame. It is pure so
// the tests can drive it.
import { clamp } from './vec.js';

/** The scale that fits a `vw` x `vh` window of the world into `w` x `h` screen px. */
export function fitScale(w, h, vw, vh) {
  return Math.min(w / vw, h / vh);
}

/**
 * Where the camera looks. On the course it follows the charge in flight, led
 * a little by its velocity so the ball is not pinned to the centre of the
 * screen; on the tee it holds the tee. Anywhere else it is the ball.
 */
export function cameraTarget(game, level, { lead = 0.3, maxLead = 260 } = {}) {
  if (!game) return { x: level.width / 2, y: level.height / 2 };
  const gf = game.golf;
  if (gf && gf.phase === 'aim') return { x: level.tee.x, y: level.tee.y };
  const b = game.ball;
  if (gf && gf.phase === 'flight') {
    let lx = b.vx * lead;
    let ly = b.vy * lead;
    const l = Math.hypot(lx, ly);
    if (l > maxLead) {
      lx *= maxLead / l;
      ly *= maxLead / l;
    }
    return { x: b.x + lx, y: b.y + ly };
  }
  return { x: b.x, y: b.y };
}

/**
 * The screen offset that puts `cam` (world px) at the centre of a `w` x `h`
 * screen at `scale`, held inside the world: the window never shows past a
 * world edge, and an axis the world does not fill is centred on it.
 */
export function cameraOffset(cam, world, w, h, scale) {
  const ww = world.w * scale;
  const wh = world.h * scale;
  const ox = ww <= w ? (w - ww) / 2 : clamp(w / 2 - cam.x * scale, w - ww, 0);
  const oy = wh <= h ? (h - wh) / 2 : clamp(h / 2 - cam.y * scale, h - wh, 0);
  return { ox, oy };
}

/** Ease `cam` toward `target`: a fraction of the way each frame, more the longer the frame. */
export function easeCamera(cam, target, dt, rate = 5) {
  if (!cam) return { x: target.x, y: target.y };
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  return { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k };
}
