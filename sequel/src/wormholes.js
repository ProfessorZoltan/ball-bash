// The robot's wormholes. A pair, light (Q / LB) and dark (E / RB), exactly
// Deflector's Wormhole Variant pair and built from the same parts in
// src/portals.js: the same mouth, the same carve, the same crossing. What is
// new is the aim. A wormhole has no range: its end goes wherever the line
// of sight first meets a surface, and that line bends through a gravity
// field the way a charge does, so what the dashed aim line shows is exactly
// where the end will land.
import { PORTAL, portalLocal, throughPortal, openPortals, partner, openedSegments } from '../../src/portals.js';
import { raycastSegments } from '../../src/physics.js';
import { wellsAccel, swallowingWell } from '../../src/gamestate.js';
import { BLASTER } from './config.js';
import { segmentsNear } from './world.js';

export { PORTAL, openPortals, openedSegments, throughPortal, portalLocal };

export const WORM = {
  step: 1 / 120, // seconds per leg of the aim line inside a well's reach
  maxLen: 200000, // px: in practice no range at all; only a line caught orbiting a well forever is cut off
  maxLegs: 6000, // legs flown inside wells before the line gives up
  minExit: 220, // px/s: whatever comes out of a mouth leaves at least this fast, so it can never hang in it
  minSurface: PORTAL.halfWidth * 2, // a surface must hold the whole mouth
};

/** How far (x, y) is from the reach of the nearest well that is there: Infinity with none. */
function toNearestField(world, x, y) {
  let d = Infinity;
  for (const w of world.wells) {
    if (w.absent) continue;
    d = Math.min(d, Math.hypot(w.x - x, w.y - y) - w.range);
  }
  return d;
}

/**
 * The line of sight from (x, y) along `angle`: flown like a charge at the
 * charge's speed, bent by every well, swallowed by a horizon, and stopped by
 * the first solid it meets (thin platforms let it through). It has no range:
 * away from every well it is a straight line cast in one go, however long,
 * and only inside a well's reach is it flown step by step. Returns the
 * polyline, and the hit: the point, the surface and whether a wormhole can
 * sit there.
 */
export function sightLine(world, x, y, angle, { speed = BLASTER.speed, maxLen = WORM.maxLen, step = WORM.step } = {}) {
  let vx = Math.cos(angle) * speed;
  let vy = Math.sin(angle) * speed;
  const pts = [[x, y]];
  let len = 0;
  let legs = 0;
  const inside = (px, py) => px > -400 && py > world.top - 600 && px < world.width + 400 && py < world.height + 600;
  while (len < maxLen && legs < WORM.maxLegs && inside(x, y)) {
    const far = toNearestField(world, x, y);
    let dx;
    let dy;
    if (far > 8) {
      // Straight: all the way to the nearest field's edge, or out of the level.
      const s = Math.hypot(vx, vy);
      const reach = Math.min(far - 4, 4000);
      dx = (vx / s) * reach;
      dy = (vy / s) * reach;
    } else {
      legs++;
      const a = wellsAccel(world.wells, x, y);
      if (a) {
        vx += a.ax * step;
        vy += a.ay * step;
        const s = Math.hypot(vx, vy);
        const c = Math.min(BLASTER.maxSpeed, Math.max(BLASTER.minSpeed, s));
        vx *= c / s;
        vy *= c / s;
      }
      if (swallowingWell(world.wells, x, y)) return { pts, hit: null, swallowed: true };
      dx = vx * step;
      dy = vy * step;
    }
    const l = Math.hypot(dx, dy);
    const segs = segmentsNear(world, Math.min(x, x + dx) - 2, Math.min(y, y + dy) - 2, Math.max(x, x + dx) + 2, Math.max(y, y + dy) + 2, { oneWay: false });
    const hit = raycastSegments(x, y, dx / l, dy / l, segs, l);
    if (hit) {
      pts.push([hit.x, hit.y]);
      return { pts, hit, ok: canHold(hit.seg) };
    }
    x += dx;
    y += dy;
    len += l;
    pts.push([x, y]);
  }
  return { pts, hit: null };
}

/** Can a wormhole's end sit on this surface? Solid ground and moving platforms, long enough for the mouth. */
export function canHold(seg) {
  return !!seg && seg.portal !== false && !seg.oneWay && !seg.crate && seg.len >= WORM.minSurface;
}

/**
 * Where `which` end would go for this sight line, as a portal record, or null.
 * Centred on the hit and slid along the surface so the whole mouth lies on
 * it, facing back along the line. An end never overlaps the other end.
 */
export function placeEnd(world, sight, which) {
  if (!sight || !sight.hit || !sight.ok) return null;
  const { hit } = sight;
  const seg = hit.seg;
  const sx = seg.bx - seg.ax;
  const sy = seg.by - seg.ay;
  const len = Math.hypot(sx, sy) || 1;
  const hw = PORTAL.halfWidth;
  let s = ((hit.x - seg.ax) * sx + (hit.y - seg.ay) * sy) / (len * len);
  s = Math.min(1 - hw / len, Math.max(hw / len, s));
  // The face the line arrived at: its normal points back toward where the line came from.
  let nx = seg.nx ?? hit.nx;
  let ny = seg.ny ?? hit.ny;
  if (nx * hit.nx + ny * hit.ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const p = { owner: 0, which, key: `0${which}`, hw, nx, ny, cx: seg.ax + sx * s, cy: seg.ay + sy * s, host: null };
  if (seg.mover) {
    const si = seg.mover.segs.indexOf(seg);
    p.host = { kind: 'mover', m: seg.mover, si, s, side: 1 };
  } else {
    p.host = { kind: 'wall', seg };
  }
  const other = world.portals[0][1 - which];
  if (other && Math.abs(other.nx * nx + other.ny * ny - 1) < 0.01) {
    const { u, v } = portalLocal(other, p.cx, p.cy);
    if (Math.abs(v) < 4 && Math.abs(u) < hw * 2) return null; // on top of its twin
  }
  return p;
}

/** Keep every end on its surface: a moving platform carries its end; one whose surface has gone takes its end with it. Returns the ends that went. */
export function refreshEnds(world) {
  const gone = [];
  const pair = world.portals[0];
  for (let w = 0; w < 2; w++) {
    const p = pair[w];
    if (!p) continue;
    const h = p.host;
    if (h.kind === 'wall') {
      if (h.seg.broken) {
        pair[w] = null;
        gone.push(p);
      }
      continue;
    }
    const seg = h.m.present ? h.m.segs[h.si] : null;
    if (!seg) {
      pair[w] = null;
      gone.push(p);
      continue;
    }
    const dx = seg.bx - seg.ax;
    const dy = seg.by - seg.ay;
    p.cx = seg.ax + dx * h.s;
    p.cy = seg.ay + dy * h.s;
    p.nx = seg.nx;
    p.ny = seg.ny;
  }
  return gone;
}

/**
 * The open mouth an upright capsule (the robot: centre x, y, a segment
 * `half` either side, radius r) is in, if any. Its reach along the mouth's
 * normal and along its face depend on which way the mouth faces: into a
 * floor it is the robot's full height, into a wall only its width.
 */
export function bodyMouth(world, x, y, r, half, ahead = 0) {
  let best = null;
  for (const p of openPortals(world)) {
    const { u, v } = portalLocal(p, x, y);
    const extV = half * Math.abs(p.ny) + r;
    const extU = half * Math.abs(p.nx) + r;
    if (Math.abs(u) > p.hw - extU * 0.5 || v >= extV + 2 + ahead || v <= -extV - 2) continue;
    if (!best || Math.abs(v) < Math.abs(best.v)) best = { p, q: partner(world, p), u, v, extV };
  }
  return best;
}

/** Leaving a mouth: at least WORM.minExit out along its face, whatever the speed going in. */
export function exitVelocity(q, vx, vy) {
  const vn = vx * q.nx + vy * q.ny;
  if (vn >= WORM.minExit) return { vx, vy };
  return { vx: vx + (WORM.minExit - vn) * q.nx, vy: vy + (WORM.minExit - vn) * q.ny };
}
