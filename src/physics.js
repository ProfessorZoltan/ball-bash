// Pure 2D collision code. No DOM access so it can be unit-tested with node.
//
// Conventions
//  - Every "surface" is either a capsule (line segment with a thickness radius)
//    or a circle. Walls are capsules with thickness 0.
//  - Contact normals always point from the surface toward the ball.
//  - `reflect` implements the moving-wall bounce rule the game is built on:
//    the ball's velocity is mirrored in the *surface's* frame of reference, so a
//    surface moving toward the ball adds speed and one moving away removes it.
//    With a static surface the outgoing speed equals the incoming speed exactly.

export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + abx * t, y: ay + aby * t, t };
}

/**
 * Overlap test between a circle (cx, cy, cr) and a capsule (segment a-b with
 * radius `thick`). Returns null when they do not touch, otherwise the contact
 * normal (from capsule to circle), the penetration depth and the contact point.
 * `hintVx/hintVy` is only used to orient the normal in the degenerate case where
 * the circle centre sits exactly on the segment.
 */
export function circleVsCapsule(cx, cy, cr, ax, ay, bx, by, thick, hintVx = 0, hintVy = 0) {
  const c = closestPointOnSegment(cx, cy, ax, ay, bx, by);
  let nx = cx - c.x;
  let ny = cy - c.y;
  let d = Math.sqrt(nx * nx + ny * ny);
  const r = cr + thick;
  if (d >= r) return null;
  if (d < 1e-6) {
    // Centre is on the segment: use the segment's perpendicular, facing against the motion.
    const sx = bx - ax;
    const sy = by - ay;
    const sl = Math.sqrt(sx * sx + sy * sy) || 1;
    nx = -sy / sl;
    ny = sx / sl;
    if (nx * hintVx + ny * hintVy > 0) {
      nx = -nx;
      ny = -ny;
    }
    d = 0;
  } else {
    nx /= d;
    ny /= d;
  }
  return { nx, ny, depth: r - d, cx: c.x, cy: c.y, t: c.t };
}

/** Circle A vs circle B. Normal points from B toward A. */
export function circleVsCircle(ax, ay, ar, bx, by, br) {
  let nx = ax - bx;
  let ny = ay - by;
  let d = Math.sqrt(nx * nx + ny * ny);
  const r = ar + br;
  if (d >= r) return null;
  if (d < 1e-6) {
    nx = 1;
    ny = 0;
    d = 0;
  } else {
    nx /= d;
    ny /= d;
  }
  return { nx, ny, depth: r - d, cx: bx + nx * br, cy: by + ny * br };
}

/**
 * Bounce `ball` (object with vx, vy) off a surface with unit normal (nx, ny)
 * whose contact point is moving with velocity (svx, svy).
 *
 * Returns false when the ball is already moving away from the surface (in the
 * surface's frame), in which case the velocity is left untouched.
 *
 * `factor` scales how much of the surface velocity is transferred. 1 is the
 * physically exact answer for an infinitely massive moving wall. It may be a
 * number or `{ toward, away }` to treat a surface closing on the ball (which
 * adds speed) differently from one retreating (which removes speed).
 */
export function reflect(ball, nx, ny, svx = 0, svy = 0, restitution = 1, factor = 1) {
  let f = factor;
  if (typeof factor === 'object') {
    const closing = svx * nx + svy * ny > 0; // surface moving toward the ball
    f = closing ? factor.toward : factor.away;
  }
  const relN = (ball.vx - svx * f) * nx + (ball.vy - svy * f) * ny;
  if (relN >= 0) return false;
  ball.vx -= (1 + restitution) * relN * nx;
  ball.vy -= (1 + restitution) * relN * ny;
  return true;
}

/** Convert a closed polygon (array of [x, y]) into its edge segments. */
export function polygonEdges(points, kind = 'wall') {
  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], kind });
  }
  return edges;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Push a circle ({x, y, r}) out of any segments it overlaps. Used for the
 * characters so they cannot walk through walls. Returns true if it moved.
 */
export function resolveCircleVsSegments(c, segs, iterations = 3, thick = 0) {
  let moved = false;
  for (let it = 0; it < iterations; it++) {
    let any = false;
    for (const s of segs) {
      const hit = circleVsCapsule(c.x, c.y, c.r, s.ax, s.ay, s.bx, s.by, s.thick ?? thick);
      if (hit) {
        c.x += hit.nx * hit.depth;
        c.y += hit.ny * hit.depth;
        any = true;
        moved = true;
      }
    }
    if (!any) break;
  }
  return moved;
}

/**
 * Cast a ray (ox, oy) + t*(dx, dy) against segments. Returns the nearest hit
 * with its distance `t`, position and a normal facing against the ray, or null.
 */
export function raycastSegments(ox, oy, dx, dy, segs, maxDist = Infinity) {
  let best = null;
  for (const s of segs) {
    const sx = s.bx - s.ax;
    const sy = s.by - s.ay;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((s.ax - ox) * sy - (s.ay - oy) * sx) / denom;
    const u = ((s.ax - ox) * dy - (s.ay - oy) * dx) / denom;
    if (t <= 1e-6 || t > maxDist || u < 0 || u > 1) continue;
    if (!best || t < best.t) {
      const sl = Math.sqrt(sx * sx + sy * sy) || 1;
      let nx = -sy / sl;
      let ny = sx / sl;
      if (nx * dx + ny * dy > 0) {
        nx = -nx;
        ny = -ny;
      }
      best = { t, x: ox + dx * t, y: oy + dy * t, nx, ny, seg: s };
    }
  }
  return best;
}

/**
 * Predict the path of a ball moving from (x, y) with velocity (vx, vy),
 * bouncing off static segments up to `bounces` times. Returns an array of
 * straight path segments {ax, ay, bx, by, dx, dy} (dx, dy = unit direction).
 */
export function predictPath(x, y, vx, vy, segs, bounces = 2, maxDist = 2500, radius = 0) {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 1e-6) return [];
  let dx = vx / speed;
  let dy = vy / speed;
  let ox = x;
  let oy = y;
  const path = [];
  let remaining = maxDist;
  for (let i = 0; i <= bounces && remaining > 0; i++) {
    const hit = raycastSegments(ox, oy, dx, dy, segs, remaining);
    if (!hit) {
      path.push({ ax: ox, ay: oy, bx: ox + dx * remaining, by: oy + dy * remaining, dx, dy });
      break;
    }
    // The ball's centre stops `radius` short of the wall along the normal.
    const dot = dx * hit.nx + dy * hit.ny;
    const back = Math.abs(dot) > 1e-3 ? Math.min(hit.t, radius / Math.abs(dot)) : 0;
    const t = hit.t - back;
    const hx = ox + dx * t;
    const hy = oy + dy * t;
    path.push({ ax: ox, ay: oy, bx: hx, by: hy, dx, dy });
    remaining -= t;
    dx -= 2 * dot * hit.nx;
    dy -= 2 * dot * hit.ny;
    // Step slightly off the wall so the next cast does not re-hit it.
    ox = hx + hit.nx * 0.5;
    oy = hy + hit.ny * 0.5;
  }
  return path;
}
