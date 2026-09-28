// Vector's arithmetic: three-vectors as plain [x, y, z] arrays, and the 4x4
// matrices the renderer hands to WebGL (column-major Float32Arrays). DOM-free,
// so the physics, the tests and the tools all share it.

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const neg = (a) => [-a[0], -a[1], -a[2]];
export const copy = (a) => [a[0], a[1], a[2]];

export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function set(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

/** The way you face for a yaw (radians, 0 looking down +z, turning toward +x) and a pitch (up is positive). */
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/** The yaw and pitch that face along d. */
export function yawPitch(d) {
  const n = norm(d);
  return { yaw: Math.atan2(n[0], n[2]), pitch: Math.asin(clamp(n[1], -1, 1)) };
}

/** Rotate v about the y axis by a (radians), the same sense as lookDir's yaw. */
export function rotY(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** Rotate v about an arbitrary unit axis by a (Rodrigues). */
export function rotAxis(v, k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** Reflect a velocity off a surface with unit normal n. */
export function reflect(v, n) {
  const d = 2 * dot(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}

/** Wrap an angle into [-π, π). */
export function wrapAngle(a) {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// ------------------------------------------------------------ randomness

/** A seeded generator (mulberry32): levels are built from it, so a seed is a level. */
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

// ------------------------------------------------------------- matrices

export function mat4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul4(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/**
 * A view matrix from a camera basis: eye, and the right, up and back (-forward)
 * axes. Written out rather than as lookAt so a camera carried through a
 * wormhole keeps exactly the basis the wormhole gives it.
 */
export function viewFromBasis(eye, right, up, fwd) {
  const m = new Float32Array(16);
  const b = neg(fwd);
  m[0] = right[0];
  m[4] = right[1];
  m[8] = right[2];
  m[1] = up[0];
  m[5] = up[1];
  m[9] = up[2];
  m[2] = b[0];
  m[6] = b[1];
  m[10] = b[2];
  m[12] = -dot(right, eye);
  m[13] = -dot(up, eye);
  m[14] = -dot(b, eye);
  m[15] = 1;
  return m;
}

/** The camera basis for a yaw and pitch, gravity down. */
export function camBasis(yaw, pitch) {
  const fwd = lookDir(yaw, pitch);
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { fwd, right, up };
}

/** A model matrix: translate to p, turn by the basis columns x, y, z, and scale by s ([sx, sy, sz]). */
export function model(p, x, y, z, s, out = new Float32Array(16)) {
  out[0] = x[0] * s[0];
  out[1] = x[1] * s[0];
  out[2] = x[2] * s[0];
  out[3] = 0;
  out[4] = y[0] * s[1];
  out[5] = y[1] * s[1];
  out[6] = y[2] * s[1];
  out[7] = 0;
  out[8] = z[0] * s[2];
  out[9] = z[1] * s[2];
  out[10] = z[2] * s[2];
  out[11] = 0;
  out[12] = p[0];
  out[13] = p[1];
  out[14] = p[2];
  out[15] = 1;
  return out;
}

/** A model matrix turned about y by yaw, then about its own x by pitch, then about its z by roll. */
export function modelYPR(p, yaw, pitch, roll, s, out) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // The columns: +z goes to lookDir(yaw, pitch), +y to the pitched up, +x to up × forward (the
  // model's left, since looking down +z the right hand is -x), then all rolled about forward.
  const fx = sy * cp;
  const fy = sp;
  const fz = cy * cp;
  const rx0 = cy;
  const rz0 = -sy;
  const ux0 = -sy * sp;
  const uy0 = cp;
  const uz0 = -cy * sp;
  const x = [rx0 * cr + ux0 * sr, uy0 * sr, rz0 * cr + uz0 * sr];
  const y = [-rx0 * sr + ux0 * cr, uy0 * cr, -rz0 * sr + uz0 * cr];
  return model(p, x, y, [fx, fy, fz], s, out);
}

/** Two unit vectors square to n, for building a basis on a surface. */
export function tangents(n) {
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = norm(cross(a, n));
  return [t, cross(n, t)];
}
