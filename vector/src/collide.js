// The shapes Vector is built from, and how things meet them. A solid is a
// convex block: an axis-aligned box, or a ramp (a box whose top slopes along
// x or z). Each carries its bounding box, its faces as planes (inside is
// n · p <= d for every one), and for each face that is a rectangle the frame a
// wormhole end needs to sit on it. DOM-free: the tests fly the robot on it.
import { dot, norm, cross, sub, add } from './math.js';

let nextId = 1;

function face(c, n, u, v, hu, hv) {
  return { c, n, u, v, hu, hv };
}

/** The six faces of a box, as planes with their rectangles. */
function boxPlanes(min, max) {
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const h = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  const out = [];
  const X = [1, 0, 0];
  const Y = [0, 1, 0];
  const Z = [0, 0, 1];
  // Each face's rectangle is spanned by u and v; for a wall, v is up.
  const faces = [
    [[1, 0, 0], max[0], [c[0] + h[0], c[1], c[2]], Z, Y, h[2], h[1]],
    [[-1, 0, 0], -min[0], [c[0] - h[0], c[1], c[2]], Z, Y, h[2], h[1]],
    [[0, 1, 0], max[1], [c[0], c[1] + h[1], c[2]], X, Z, h[0], h[2]],
    [[0, -1, 0], -min[1], [c[0], c[1] - h[1], c[2]], X, Z, h[0], h[2]],
    [[0, 0, 1], max[2], [c[0], c[1], c[2] + h[2]], X, Y, h[0], h[1]],
    [[0, 0, -1], -min[2], [c[0], c[1], c[2] - h[2]], X, Y, h[0], h[1]],
  ];
  for (const [n, d, fc, u, v, hu, hv] of faces) out.push({ n, d, face: face(fc, n, u, v, hu, hv) });
  return out;
}

/**
 * A ramp's planes. It fills its box below a slope that climbs along `axis`
 * ('x' or 'z') toward `dir` (+1 or -1), from `lo` (a share of its height) at
 * the low end to the full height at the high end.
 */
function rampPlanes(min, max, axis, dir, lo) {
  const ai = axis === 'x' ? 0 : 2;
  const si = axis === 'x' ? 2 : 0;
  const hgt = max[1] - min[1];
  const yLo = min[1] + hgt * lo;
  const a0 = dir > 0 ? min[ai] : max[ai]; // the low end
  const a1 = dir > 0 ? max[ai] : min[ai]; // the high end
  const out = [];
  const unit = (i, s) => {
    const n = [0, 0, 0];
    n[i] = s;
    return n;
  };
  // The slope: its normal leans back toward the low end.
  const run = Math.abs(a1 - a0);
  const n = [0, 0, 0];
  n[ai] = -dir * (max[1] - yLo);
  n[1] = run;
  const nn = norm(n);
  const p0 = [0, yLo, 0];
  p0[ai] = a0;
  const along = [0, 0, 0];
  along[ai] = dir * run;
  along[1] = max[1] - yLo;
  const slopeLen = Math.hypot(run, max[1] - yLo);
  const t = norm(along);
  const side = unit(si, 1);
  const mid = [0, (yLo + max[1]) / 2, 0];
  mid[ai] = (a0 + a1) / 2;
  mid[si] = (min[si] + max[si]) / 2;
  out.push({ n: nn, d: dot(nn, p0), face: face(mid, nn, side, t, (max[si] - min[si]) / 2, slopeLen / 2), slope: true });
  // The bottom.
  out.push({ n: [0, -1, 0], d: -min[1], face: face([(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2], [0, -1, 0], [1, 0, 0], [0, 0, 1], (max[0] - min[0]) / 2, (max[2] - min[2]) / 2) });
  // The two sides are not rectangles, so they hold no wormhole.
  out.push({ n: unit(si, 1), d: max[si], face: null });
  out.push({ n: unit(si, -1), d: -min[si], face: null });
  // The tall back wall at the high end.
  const back = unit(ai, dir);
  const bc = [0, (min[1] + max[1]) / 2, 0];
  bc[ai] = a1;
  bc[si] = (min[si] + max[si]) / 2;
  out.push({ n: back, d: dir * a1, face: face(bc, back, side, [0, 1, 0], (max[si] - min[si]) / 2, hgt / 2) });
  // The low end, if the slope does not come down to the ground.
  if (lo > 0.001) {
    const fr = unit(ai, -dir);
    const fc = [0, (min[1] + yLo) / 2, 0];
    fc[ai] = a0;
    fc[si] = (min[si] + max[si]) / 2;
    out.push({ n: fr, d: -dir * a0, face: face(fc, fr, side, [0, 1, 0], (max[si] - min[si]) / 2, (yLo - min[1]) / 2) });
  }
  return out;
}

/**
 * A solid. `props` carries what it is to the game and how it looks: `mat`
 * (the renderer's material), `color`, and flags such as `glass` (solid, but
 * the line of sight goes through and holds no wormhole), `noPortal`, `door`,
 * `crate`, `cover`, `spring`, `hazard`.
 */
export function box(min, max, props = {}) {
  const s = { id: nextId++, shape: 'box', min: [...min], max: [...max], planes: boxPlanes(min, max), vel: [0, 0, 0], ...props };
  return s;
}

export function ramp(min, max, axis, dir, props = {}) {
  const lo = props.lo ?? 0;
  const s = { id: nextId++, shape: 'ramp', axis, dir, lo, min: [...min], max: [...max], planes: rampPlanes(min, max, axis, dir, lo), vel: [0, 0, 0], ...props };
  return s;
}

/** Move a solid by d, planes and faces with it (a moving platform, a door). */
export function translate(s, d) {
  for (let i = 0; i < 3; i++) {
    s.min[i] += d[i];
    s.max[i] += d[i];
  }
  for (const p of s.planes) {
    p.d += dot(p.n, d);
    if (p.face) p.face.c = add(p.face.c, d);
  }
}

/** Put a solid's box at a new place, keeping its size. */
export function moveTo(s, min) {
  translate(s, sub(min, s.min));
}

/** The height of a ramp's slope, or a box's top, at (x, z). */
export function topAt(s, x, z) {
  if (s.shape !== 'ramp') return s.max[1];
  const ai = s.axis === 'x' ? 0 : 2;
  const v = ai === 0 ? x : z;
  const a0 = s.dir > 0 ? s.min[ai] : s.max[ai];
  const a1 = s.dir > 0 ? s.max[ai] : s.min[ai];
  const u = Math.max(0, Math.min(1, (v - a0) / (a1 - a0)));
  const yLo = s.min[1] + (s.max[1] - s.min[1]) * s.lo;
  return yLo + (s.max[1] - yLo) * u;
}

export function overlaps(s, min, max) {
  return s.min[0] <= max[0] && s.max[0] >= min[0] && s.min[1] <= max[1] && s.max[1] >= min[1] && s.min[2] <= max[2] && s.max[2] >= min[2];
}

// ------------------------------------------------------------ contacts

/** The deepest face contact of a convex solid with a sphere at c (the fallback for the inside, and for ramps). */
function sphereSat(s, c, r) {
  let best = -Infinity;
  let bn = null;
  for (const p of s.planes) {
    const sd = dot(p.n, c) - p.d;
    if (sd >= r) return null;
    if (sd > best) {
      best = sd;
      bn = p.n;
    }
  }
  return { n: bn, depth: r - best };
}

/**
 * A sphere against a solid: the way out (unit n) and how far in it is, or
 * null. Boxes are met exactly, rounded corners and all, so a charge that
 * clips an edge glances off it at the true angle.
 */
export function sphereVs(s, c, r) {
  if (c[0] < s.min[0] - r || c[0] > s.max[0] + r || c[1] < s.min[1] - r || c[1] > s.max[1] + r || c[2] < s.min[2] - r || c[2] > s.max[2] + r) return null;
  if (s.shape !== 'box') return sphereSat(s, c, r);
  const q = [Math.max(s.min[0], Math.min(s.max[0], c[0])), Math.max(s.min[1], Math.min(s.max[1], c[1])), Math.max(s.min[2], Math.min(s.max[2], c[2]))];
  const dx = c[0] - q[0];
  const dy = c[1] - q[1];
  const dz = c[2] - q[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    return { n: [dx / d, dy / d, dz / d], depth: r - d };
  }
  return sphereSat(s, c, r);
}

/**
 * An upright capsule (its centre c, a segment `half` up and down, `r` thick)
 * against a solid. Boxes exactly; ramps by their faces, which squares off the
 * corners a little (nothing stands on a ramp's corner).
 */
export function capsuleVs(s, c, half, r) {
  const ya = c[1] - half;
  const yb = c[1] + half;
  if (c[0] < s.min[0] - r || c[0] > s.max[0] + r || yb < s.min[1] - r || ya > s.max[1] + r || c[2] < s.min[2] - r || c[2] > s.max[2] + r) return null;
  if (s.shape === 'box') {
    const qx = Math.max(s.min[0], Math.min(s.max[0], c[0]));
    const qz = Math.max(s.min[2], Math.min(s.max[2], c[2]));
    let py;
    let qy;
    if (ya > s.max[1]) {
      py = ya;
      qy = s.max[1];
    } else if (yb < s.min[1]) {
      py = yb;
      qy = s.min[1];
    } else {
      py = qy = (Math.max(ya, s.min[1]) + Math.min(yb, s.max[1])) / 2;
    }
    const dx = c[0] - qx;
    const dy = py - qy;
    const dz = c[2] - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return null;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      return { n: [dx / d, dy / d, dz / d], depth: r - d };
    }
  }
  let best = -Infinity;
  let bn = null;
  for (const p of s.planes) {
    const sa = p.n[0] * c[0] + p.n[1] * ya + p.n[2] * c[2] - p.d;
    const sb = p.n[0] * c[0] + p.n[1] * yb + p.n[2] * c[2] - p.d;
    const sd = Math.min(sa, sb);
    if (sd >= r) return null;
    if (sd > best) {
      best = sd;
      bn = p.n;
    }
  }
  return { n: bn, depth: r - best };
}

/**
 * A ray from o along unit dir, up to maxT, against a solid: where it enters
 * (t, the point, the face's normal and plane) or null. A ray that starts
 * inside a solid does not hit it.
 */
export function rayVs(s, o, dir, maxT, pad = 0) {
  // The bounding box first, cheaply.
  let t0 = 0;
  let t1 = maxT;
  for (let i = 0; i < 3; i++) {
    const lo = s.min[i] - pad;
    const hi = s.max[i] + pad;
    if (Math.abs(dir[i]) < 1e-12) {
      if (o[i] < lo || o[i] > hi) return null;
    } else {
      let a = (lo - o[i]) / dir[i];
      let b = (hi - o[i]) / dir[i];
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
  }
  let tEnter = -Infinity;
  let tExit = maxT;
  let hitPlane = null;
  for (const p of s.planes) {
    const denom = dot(p.n, dir);
    const num = p.d + pad - dot(p.n, o);
    if (Math.abs(denom) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    const t = num / denom;
    if (denom < 0) {
      if (t > tEnter) {
        tEnter = t;
        hitPlane = p;
      }
    } else if (t < tExit) tExit = t;
    if (tEnter > tExit) return null;
  }
  if (!hitPlane || tEnter < 0 || tEnter > maxT) return null;
  return { t: tEnter, p: [o[0] + dir[0] * tEnter, o[1] + dir[1] * tEnter, o[2] + dir[2] * tEnter], n: hitPlane.n, plane: hitPlane, solid: s };
}

/** Is p inside the solid (by more than `pad`)? */
export function inside(s, p, pad = 0) {
  for (const pl of s.planes) if (dot(pl.n, p) - pl.d > -pad) return false;
  return true;
}

/** The point on a face's rectangle nearest p, in the face's own (u, v) coordinates. */
export function faceCoords(f, p) {
  const d = sub(p, f.c);
  return [dot(d, f.u), dot(d, f.v)];
}

export function faceBasis(n) {
  // A face's in-plane axes for a wall: v up, u across. For a floor or a roof,
  // any pair (the caller turns it to the way the robot faces).
  if (Math.abs(n[1]) < 0.7) {
    const u = norm(cross([0, 1, 0], n));
    return { u, v: cross(n, u) };
  }
  const u = norm(cross(n, [0, 0, 1]));
  return { u, v: cross(n, u) };
}

