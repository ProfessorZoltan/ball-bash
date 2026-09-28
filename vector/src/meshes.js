// Geometry for the renderer, as flat arrays of vertices. DOM-free, so the
// tests can count what a level builds. A vertex is 15 floats:
//
//   position (3), normal (3), colour (3), uv (2), size (2), material (1), glow (1)
//
// `uv` is where the point is on its face in metres, and `size` the face's
// size, so the shader can draw the grid's lines and light a face's edges at
// any scale. A triangle-faced shape (the grid's polyhedra) puts barycentric
// weights in uv and a negative size, and the shader lights its edges instead.
import { cross, sub, norm, add, scale, dot } from './math.js';

export const STRIDE = 15;

/** Material ids, shared with the shader (render.js). */
export const MAT = {
  plain: 0,
  grid: 1,
  panel: 2,
  glass: 3,
  metal: 4,
  concrete: 5,
  brick: 6,
  wood: 7,
  grass: 8,
  asphalt: 9,
  water: 10,
  snow: 11,
  rock: 12,
  leaf: 13,
  lamp: 14,
  crate: 15,
  cracked: 16,
  hazard: 17,
  paper: 18,
  container: 19,
  tile: 20,
  bark: 21,
  wire: 22,
  screen: 23,
  cloth: 24,
};

export class MeshData {
  constructor() {
    this.v = [];
    this.count = 0;
  }

  vert(p, n, c, u, v, sw, sh, mat, glow) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], u, v, sw, sh, mat, glow);
    this.count++;
  }

  /**
   * A flat quad a, b, c, d (counter-clockwise seen from the front), w by h
   * metres, uv running from a (0, 0) toward b (w, 0) and d (0, h).
   */
  quad(a, b, c, d, col, mat = 0, glow = 0, n = null) {
    const nn = n || norm(cross(sub(b, a), sub(d, a)));
    const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const h = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    this.vert(a, nn, col, 0, 0, w, h, mat, glow);
    this.vert(b, nn, col, w, 0, w, h, mat, glow);
    this.vert(c, nn, col, w, h, w, h, mat, glow);
    this.vert(a, nn, col, 0, 0, w, h, mat, glow);
    this.vert(c, nn, col, w, h, w, h, mat, glow);
    this.vert(d, nn, col, 0, h, w, h, mat, glow);
  }

  /** A triangle, its edges lit the grid's way (barycentric in uv). */
  tri(a, b, c, col, mat = 0, glow = 0, n = null) {
    const nn = n || norm(cross(sub(b, a), sub(c, a)));
    this.vert(a, nn, col, 1, 0, -1, -1, mat, glow);
    this.vert(b, nn, col, 0, 1, -1, -1, mat, glow);
    this.vert(c, nn, col, 0, 0, -1, -1, mat, glow);
  }

  /** A smooth triangle, normals per corner, no edges drawn. */
  triSmooth(a, b, c, na, nb, nc, col, mat = 0, glow = 0) {
    this.vert(a, na, col, 0.5, 0.5, 1, 1, mat, glow);
    this.vert(b, nb, col, 0.5, 0.5, 1, 1, mat, glow);
    this.vert(c, nc, col, 0.5, 0.5, 1, 1, mat, glow);
  }

  append(other) {
    for (let i = 0; i < other.v.length; i++) this.v.push(other.v[i]);
    this.count += other.count;
  }

  array() {
    return new Float32Array(this.v);
  }
}

/** The faces of a box from min to max, each with its own uv in metres. `skip` names faces to leave out ('top', 'bottom', ...). */
export function boxFaces(m, min, max, col, mat = 0, glow = 0, skip = null, colTop = null) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const top = colTop || col;
  const want = (k) => !skip || !skip.includes(k);
  if (want('top')) m.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top, mat, glow, [0, 1, 0]);
  if (want('bottom')) m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, mat, glow, [0, -1, 0]);
  if (want('px')) m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col, mat, glow, [1, 0, 0]);
  if (want('nx')) m.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], col, mat, glow, [-1, 0, 0]);
  if (want('pz')) m.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], col, mat, glow, [0, 0, 1]);
  if (want('nz')) m.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], col, mat, glow, [0, 0, -1]);
}

/** A solid (collide.js) as faces: a box's six, or a ramp's slope, sides, back and foot. */
export function solidFaces(m, s, col, mat, glow = 0, colTop = null) {
  if (s.shape === 'box') {
    boxFaces(m, s.min, s.max, col, mat, glow, s.skipFaces, colTop);
    return;
  }
  const { min, max, axis, dir, lo } = s;
  const yLo = min[1] + (max[1] - min[1]) * lo;
  // Work in (a, s) = (along the climb, across), then place.
  const P = (a, y, sd) => (axis === 'x' ? [a, y, sd] : [sd, y, a]);
  const a0 = dir > 0 ? (axis === 'x' ? min[0] : min[2]) : axis === 'x' ? max[0] : max[2];
  const a1 = dir > 0 ? (axis === 'x' ? max[0] : max[2]) : axis === 'x' ? min[0] : min[2];
  const s0 = axis === 'x' ? min[2] : min[0];
  const s1 = axis === 'x' ? max[2] : max[0];
  const top = colTop || col;
  // The slope, winding so it faces up.
  const q = [P(a0, yLo, s0), P(a1, max[1], s0), P(a1, max[1], s1), P(a0, yLo, s1)];
  let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
  if (n[1] < 0) m.quad(q[0], q[3], q[2], q[1], top, mat, glow);
  else m.quad(q[0], q[1], q[2], q[3], top, mat, glow);
  // The back wall at the high end, and the foot at the low end.
  const back = [P(a1, min[1], s0), P(a1, min[1], s1), P(a1, max[1], s1), P(a1, max[1], s0)];
  n = norm(cross(sub(back[1], back[0]), sub(back[3], back[0])));
  const out = axis === 'x' ? [dir, 0, 0] : [0, 0, dir];
  if (dot(n, out) < 0) m.quad(back[0], back[3], back[2], back[1], col, mat, glow);
  else m.quad(back[0], back[1], back[2], back[3], col, mat, glow);
  if (lo > 0.001) {
    const f = [P(a0, min[1], s1), P(a0, min[1], s0), P(a0, yLo, s0), P(a0, yLo, s1)];
    n = norm(cross(sub(f[1], f[0]), sub(f[3], f[0])));
    if (dot(n, out) > 0) m.quad(f[0], f[3], f[2], f[1], col, mat, glow);
    else m.quad(f[0], f[1], f[2], f[3], col, mat, glow);
  }
  // The sides: a trapezoid each, as two triangles with square uv.
  for (const sd of [s0, s1]) {
    const pts = [P(a0, min[1], sd), P(a1, min[1], sd), P(a1, max[1], sd), P(a0, yLo, sd)];
    let nn = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const want = axis === 'x' ? (sd === s0 ? -1 : 1) : sd === s0 ? -1 : 1;
    const idx = axis === 'x' ? 2 : 0;
    if (Math.sign(nn[idx]) !== want) {
      pts.reverse();
      nn = scale(nn, -1);
    }
    const w = Math.abs(a1 - a0);
    const h = max[1] - min[1];
    const uvOf = (p) => [Math.abs((axis === 'x' ? p[0] : p[2]) - a0), p[1] - min[1]];
    const tri = (A, B, C) => {
      for (const p of [A, B, C]) {
        const [u, v] = uvOf(p);
        m.vert(p, nn, col, u, v, w, h, mat, glow);
      }
    };
    tri(pts[0], pts[1], pts[2]);
    tri(pts[0], pts[2], pts[3]);
  }
  // The bottom.
  const b = [P(a0, min[1], s0), P(a0, min[1], s1), P(a1, min[1], s1), P(a1, min[1], s0)];
  n = norm(cross(sub(b[1], b[0]), sub(b[3], b[0])));
  if (n[1] > 0) m.quad(b[0], b[3], b[2], b[1], col, mat, glow);
  else m.quad(b[0], b[1], b[2], b[3], col, mat, glow);
}

// ------------------------------------------------------------- primitives
// Each is built round the origin at unit size, for drawing with a model matrix.

export function unitBox(col = [1, 1, 1], mat = 0, glow = 0) {
  const m = new MeshData();
  boxFaces(m, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], col, mat, glow);
  return m;
}

export function sphere(seg = 16, ring = 10, col = [1, 1, 1], mat = 0, glow = 0) {
  const m = new MeshData();
  const P = (i, j) => {
    const th = (i / seg) * Math.PI * 2;
    const ph = (j / ring) * Math.PI - Math.PI / 2;
    return [Math.cos(ph) * Math.cos(th) * 0.5, Math.sin(ph) * 0.5, Math.cos(ph) * Math.sin(th) * 0.5];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < ring; j++) {
      const a = P(i, j);
      const b = P(i + 1, j);
      const c = P(i + 1, j + 1);
      const d = P(i, j + 1);
      const n = (p) => norm(p);
      m.triSmooth(a, c, b, n(a), n(c), n(b), col, mat, glow);
      m.triSmooth(a, d, c, n(a), n(d), n(c), col, mat, glow);
    }
  }
  return m;
}

/** A cylinder along y from -0.5 to 0.5, radius 0.5; `r1` narrows the top (a cone at 0). */
export function cylinder(seg = 16, col = [1, 1, 1], mat = 0, glow = 0, r1 = 0.5, caps = true) {
  const m = new MeshData();
  const r0 = 0.5;
  const slope = (r0 - r1) / 1;
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2;
    const t1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = [Math.cos(t0), Math.sin(t0)];
    const c1 = [Math.cos(t1), Math.sin(t1)];
    const a = [c0[0] * r0, -0.5, c0[1] * r0];
    const b = [c1[0] * r0, -0.5, c1[1] * r0];
    const c = [c1[0] * r1, 0.5, c1[1] * r1];
    const d = [c0[0] * r1, 0.5, c0[1] * r1];
    const na = norm([c0[0], slope, c0[1]]);
    const nb = norm([c1[0], slope, c1[1]]);
    m.triSmooth(a, c, b, na, nb, nb, col, mat, glow);
    m.triSmooth(a, d, c, na, na, nb, col, mat, glow);
    if (caps) {
      m.triSmooth([0, -0.5, 0], a, b, [0, -1, 0], [0, -1, 0], [0, -1, 0], col, mat, glow);
      if (r1 > 0) m.triSmooth([0, 0.5, 0], c, d, [0, 1, 0], [0, 1, 0], [0, 1, 0], col, mat, glow);
    }
  }
  return m;
}

export function cone(seg = 16, col = [1, 1, 1], mat = 0, glow = 0) {
  return cylinder(seg, col, mat, glow, 0, true);
}

/** A torus in the xz plane: radius 0.5 to the middle of a tube `tube` thick. */
export function torus(seg = 24, side = 8, tube = 0.08, col = [1, 1, 1], mat = 0, glow = 0) {
  const m = new MeshData();
  const R = 0.5;
  const P = (i, j) => {
    const u = (i / seg) * Math.PI * 2;
    const v = (j / side) * Math.PI * 2;
    const cx = Math.cos(u);
    const cz = Math.sin(u);
    const p = [(R + tube * Math.cos(v)) * cx, tube * Math.sin(v), (R + tube * Math.cos(v)) * cz];
    const n = [Math.cos(v) * cx, Math.sin(v), Math.cos(v) * cz];
    return [p, n];
  };
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < side; j++) {
      const [a, na] = P(i, j);
      const [b, nb] = P(i + 1, j);
      const [c, nc] = P(i + 1, j + 1);
      const [d, nd] = P(i, j + 1);
      m.triSmooth(a, c, b, na, nc, nb, col, mat, glow);
      m.triSmooth(a, d, c, na, nd, nc, col, mat, glow);
    }
  }
  return m;
}

/** The grid's own shapes, flat-faced with lit edges: 4 (tetrahedron), 8 (octahedron) or 20 (icosahedron) faces. */
export function polyhedron(kind = 8, col = [1, 1, 1], mat = 0, glow = 0) {
  const m = new MeshData();
  let V;
  let F;
  if (kind === 4) {
    V = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map((p) => scale(norm(p), 0.5));
    F = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  } else if (kind === 20) {
    const t = (1 + Math.sqrt(5)) / 2;
    V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => scale(norm(p), 0.5));
    F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  } else {
    V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((p) => scale(p, 0.5));
    F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  }
  for (const [a, b, c] of F) {
    const pa = V[a];
    const pb = V[b];
    const pc = V[c];
    let n = norm(cross(sub(pb, pa), sub(pc, pa)));
    const mid = scale(add(add(pa, pb), pc), 1 / 3);
    if (dot(n, mid) < 0) {
      m.tri(pa, pc, pb, col, mat, glow);
    } else m.tri(pa, pb, pc, col, mat, glow, n);
  }
  return m;
}

/** A cone of flat triangle faces, its edges lit the grid's way: the grid's mountains. */
export function pyramid(seg = 6, col = [1, 1, 1], mat = 0, glow = 0) {
  const m = new MeshData();
  const top = [0, 0.5, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * 0.5, -0.5, Math.sin(a0) * 0.5];
    const p1 = [Math.cos(a1) * 0.5, -0.5, Math.sin(a1) * 0.5];
    m.tri(p0, top, p1, col, mat, glow);
  }
  return m;
}

/**
 * A wormhole's mouth: a rounded rectangle `a` by `b` (half sizes) with
 * corners `k`, in the xy plane facing +z, as a fan. uv carries the point's
 * place in the mouth (-1 to 1 across, and along) for the rim's glow.
 */
export function mouth(a, b, k, seg = 6) {
  const m = new MeshData();
  const pts = [];
  const corners = [[a - k, b - k, 0], [-(a - k), b - k, Math.PI / 2], [-(a - k), -(b - k), Math.PI], [a - k, -(b - k), (3 * Math.PI) / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * k, cy + Math.sin(t) * k, 0]);
    }
  }
  const n = [0, 0, 1];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    m.vert([0, 0, 0], n, [1, 1, 1], 0, 0, a, b, 0, 0);
    m.vert(p, n, [1, 1, 1], p[0] / a, p[1] / b, a, b, 0, 1);
    m.vert(q, n, [1, 1, 1], q[0] / a, q[1] / b, a, b, 0, 1);
  }
  return m;
}

/** The mouth's throat: the same outline drawn back `depth` into the surface, inside out, so a camera passing through the plane still sees the view. */
export function throat(a, b, k, depth, seg = 6) {
  const m = new MeshData();
  const pts = [];
  const corners = [[a - k, b - k, 0], [-(a - k), b - k, Math.PI / 2], [-(a - k), -(b - k), Math.PI], [a - k, -(b - k), (3 * Math.PI) / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * k, cy + Math.sin(t) * k]);
    }
  }
  const n = [0, 0, 1];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const A = [p[0], p[1], 0];
    const B = [q[0], q[1], 0];
    const C = [q[0], q[1], -depth];
    const D = [p[0], p[1], -depth];
    for (const v of [A, B, C, A, C, D]) m.vert(v, n, [1, 1, 1], 0, 0, a, b, 0, 0);
  }
  // The back.
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    for (const v of [[0, 0, -depth], [q[0], q[1], -depth], [p[0], p[1], -depth]]) m.vert(v, n, [1, 1, 1], 0, 0, a, b, 0, 0);
  }
  return m;
}
