// Gravitational lensing: a black hole bends the picture round it, as it
// already bends a charge's flight and a wormhole's line of sight. It is a
// lens on the drawn frame, never a change to the world, so the physics, the
// levels and the aim stay exactly as they are.
//
// Each hole's lens lies in a plane through the hole, square to the line from
// the eye. A line of sight that crosses that plane b metres from the hole
// shows what lies behind the plane at bend(b) metres from it instead: nearer
// the hole for a black hole, so the picture is drawn round it into a ring,
// and inside the ring is its shadow, where the light would have had to come
// from the far side; further out for a white hole, so the picture shrinks
// in toward it. At the edge of the hole's reach the bend is nothing, so
// there is no seam, and bend(b) only ever grows with b, so everything is
// seen once and every bend can be undone. Only what stands behind the
// hole's plane is bent (fully once it is `LENS.ramp` behind): whatever is
// in front of a hole is seen as it is.
//
// The renderer's lens pass (LENS_FS in shaders.js) does per pixel what
// sourceOf does here per point, with the same numbers; seenAt undoes it, so
// the crosshair and the name tags sit on what they mark. DOM-free.
import { add, sub, scale, dot, len, clamp, smooth } from './math.js';

export const LENS = {
  max: 4, // holes bent at once: the nearest in view
  ramp: 2.5, // m behind a hole's plane at which what is there is bent fully
  near: 0.3, // m: a hole nearer the eye's plane than this bends nothing
};

/**
 * A hole's lens, from its horizon and its pull. `E` is the black hole's
 * Einstein radius (m), two and a half horizons and more with a stronger
 * pull: its shadow's edge falls between the glowing ring drawn round it
 * (two horizons out) and the thin outer one (two and three quarters), so
 * the picture bent round it shows just outside the ring. `c` is how hard a
 * white hole draws the picture in; kept under 3, so the bend always grows.
 */
export function lensOf(w) {
  const grow = Math.log2(Math.max(1, w.pull / 300));
  if (w.white) return { white: true, R: w.reach, E: 0, c: Math.min(2, 0.6 + 0.3 * grow), h: w.horizon };
  return { white: false, R: w.reach, E: w.horizon * (2.5 + 0.15 * grow), c: 0, h: w.horizon };
}

/**
 * Where a line of sight crossing the hole's plane `b` metres out really
 * comes from, bent by the share `k` (0 to 1) that what it shows is behind
 * the hole. A black hole's is below zero inside its shadow.
 */
export function bend(b, L, k = 1) {
  if (b >= L.R || k <= 0) return b;
  const u = 1 - b / L.R;
  if (L.white) return b + k * L.c * b * u * u;
  return b - (k * L.E * L.E * u * u) / Math.max(b, 1e-9);
}

/** The black hole's shadow: how far out its edge is, where the bend reaches zero. */
export function shadowEdge(L, k = 1) {
  if (L.white || k <= 0) return 0;
  const e = Math.sqrt(k) * L.E;
  return e / (1 + e / L.R);
}

/** The bend undone: the b whose bend is `bs`. The bend only grows, so halving the gap finds it. */
export function unbend(bs, L, k = 1) {
  if (bs >= L.R || k <= 0) return bs;
  let lo = L.white ? 0 : Math.max(1e-9, shadowEdge(L, k));
  let hi = L.R;
  if (!L.white && bs <= 0) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bend(mid, L, k) < bs) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How much of the bend what is seen at `p` takes: none in front of the hole's plane, all of it `LENS.ramp` behind. */
export function weight(lens, p) {
  return smooth(clamp(dot(sub(p, lens.c), lens.n) / LENS.ramp, 0, 1));
}

// ------------------------------------------------------------------ the screen

/**
 * The camera, as the lens needs it: `eye`, its `right`, `up` and `fwd`, and
 * `tx`, `ty`, the tangents of half the view across and up. A point on the
 * screen is [u, v], each 0 to 1, v up.
 */
export function rayAt(cam, uv) {
  const x = (uv[0] * 2 - 1) * cam.tx;
  const y = (uv[1] * 2 - 1) * cam.ty;
  return add(cam.fwd, add(scale(cam.right, x), scale(cam.up, y)));
}

/** Where a point in front of the camera is drawn, before any lens. */
export function uvOf(cam, p) {
  const d = sub(p, cam.eye);
  const z = Math.max(dot(d, cam.fwd), 1e-6);
  return [(dot(d, cam.right) / (z * cam.tx)) * 0.5 + 0.5, (dot(d, cam.up) / (z * cam.ty)) * 0.5 + 0.5];
}

/**
 * This frame's lenses: the holes that are on, in front of the eye and whose
 * reach comes into view, nearest first, at most `LENS.max`.
 */
export function lensesFor(cam, wells) {
  const out = [];
  const half = Math.atan(Math.hypot(cam.tx, cam.ty));
  for (const w of wells) {
    if (w.off) continue;
    const to = sub(w.p, cam.eye);
    const D = len(to);
    if (D < w.horizon * 1.5) continue;
    const n = scale(to, 1 / D);
    if (dot(to, cam.fwd) < LENS.near) continue;
    const L = lensOf(w);
    const off = Math.acos(clamp(dot(n, cam.fwd), -1, 1));
    if (off > half + Math.asin(Math.min(1, L.R / D))) continue;
    out.push({ c: w.p, D, n, L });
  }
  out.sort((a, b) => a.D - b.D);
  return out.slice(0, LENS.max);
}

/** Where a line of sight through `uv` crosses a lens's plane, from the hole; null if it never does. */
function crossing(cam, lens, uv) {
  const dir = rayAt(cam, uv);
  const dn = dot(dir, lens.n);
  if (dn <= 1e-4) return null;
  return sub(add(cam.eye, scale(dir, lens.D / dn)), lens.c);
}

/** One lens's bend of a screen point, `k` of it: the point it shows, and whether that is the shadow. */
export function bendAt(cam, lens, uv, k) {
  const off = crossing(cam, lens, uv);
  if (!off || k <= 0) return { uv, shadow: false };
  const b = len(off);
  if (b >= lens.L.R) return { uv, shadow: false };
  const bs = bend(b, lens.L, k);
  if (bs <= 0) return { uv, shadow: true };
  const src = add(lens.c, scale(off, bs / b));
  if (dot(sub(src, cam.eye), cam.fwd) < LENS.near) return { uv, shadow: false };
  return { uv: uvOf(cam, src), shadow: false };
}

/** One lens's bend undone: the screen point that shows what is at `uv` unbent. */
export function unbendAt(cam, lens, uv, k) {
  const off = crossing(cam, lens, uv);
  if (!off || k <= 0) return uv;
  const bs = len(off);
  if (bs >= lens.L.R || bs < 1e-9) return uv;
  const b = unbend(bs, lens.L, k);
  return uvOf(cam, add(lens.c, scale(off, b / bs)));
}

/**
 * What the screen shows at `uv`, where the point seen there is `p`: the
 * unbent screen point it is drawn from, each lens in turn, and whether it
 * is in a shadow.
 */
export function sourceOf(cam, lenses, uv, p) {
  let q = uv;
  let shadow = false;
  for (const lens of lenses) {
    const r = bendAt(cam, lens, q, weight(lens, p));
    q = r.uv;
    shadow = shadow || r.shadow;
  }
  return { uv: q, shadow };
}

/** Where on the screen a point in the world is seen through this frame's lenses: sourceOf undone. */
export function seenAt(cam, lenses, p) {
  let q = uvOf(cam, p);
  for (let i = lenses.length - 1; i >= 0; i--) q = unbendAt(cam, lenses[i], q, weight(lenses[i], p));
  return q;
}
