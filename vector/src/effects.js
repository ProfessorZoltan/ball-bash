// What the renderer adds at High quality, worked out without a page: the
// sun's shadows, which come in as the world gets real, and bloom, the glow
// that bleeds off the grid's neon and fades to a trace on the real world's
// lamps and sun. Here too are the boxes the sun's shadows are drawn in:
// squares of ground round where you are looking, a fine one near and a
// coarse one far, seen straight down the sun, each stepped a whole texel at
// a time so the shadows' edges hold still as you walk.
// DOM-free.
import { dot, cross, norm, sub, add, scale, viewFromBasis, mul4 } from './math.js';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much shadow and bloom a level gets, from how real it is (its theme's
 * `real`, 0 the grid, 1 the world). Shadows start a fifth of the way out of
 * the grid and are whole by six tenths; under a roof, where the "sun" is the
 * room's own light, and in rain, they are softer. Bloom is whole in the
 * grid and falls away as the neon goes. `threshold` is how bright a pixel
 * must be (on the screen's curve, 0 to 1) before it glows: in the grid its
 * lines, in the world only its lamps and the sun.
 */
export function effects(theme, def = {}) {
  const real = theme.real ?? 0;
  const sunlight = smooth(0.2, 0.6, real);
  const shadow = sunlight * (def.roof ? 0.65 : 1) * (theme.rain ? 0.7 : 1);
  const bloom = 0.16 + 0.64 * (1 - real) * (1 - real);
  const threshold = 0.62 + 0.26 * real;
  return { sunlight, shadow: shadow < 0.02 ? 0 : shadow, bloom, threshold };
}

/** An orthographic projection: x from l to r, y from b to t, and depth from n to f in front. */
export function ortho(l, r, b, t, n, f) {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(f + n) / (f - n);
  m[15] = 1;
  return m;
}

/**
 * The sun's view for its shadows: a square `size` metres across, seen down
 * the sun, centred a little ahead of the eye along the way it looks (so more
 * of what is in view is inside it), and `depth` metres deep either side of
 * the ground so what stands tall or far toward the sun still casts. Its
 * centre is moved only in whole texels of a map `res` across, so a shadow's
 * edge falls on the same texels frame after frame. Returns the view and
 * projection together (`vp`), the texel's size in metres and the basis.
 */
export function sunBox(eye, fwd, sunDir, size = 80, res = 2048, depth = 160) {
  const z = norm(sunDir); // from the ground toward the sun
  const up = Math.abs(z[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const flat = norm([fwd[0], 0, fwd[2]]);
  const ahead = Number.isFinite(flat[0]) ? flat : [0, 0, 1];
  const c = add(eye, scale(ahead, size * 0.3));
  const texel = size / res;
  const cx = Math.round(dot(c, x) / texel) * texel;
  const cy = Math.round(dot(c, y) / texel) * texel;
  const cz = dot(c, z);
  const centre = add(add(scale(x, cx), scale(y, cy)), scale(z, cz));
  const from = add(centre, scale(z, depth));
  // The camera sits `depth` toward the sun and looks back down it.
  const view = viewFromBasis(from, x, y, scale(z, -1));
  const proj = ortho(-size / 2, size / 2, -size / 2, size / 2, 0, depth * 2);
  return { vp: mul4(proj, view), texel, centre, x, y, z, size, depth };
}

/**
 * The sun's shadows in two squares, one inside the other (cascades): a fine
 * one close round where you look, and a coarse one four times as wide,
 * centred further ahead, that shades the far ground out to about 290 m.
 * Each has its own depth map; the world shader takes the fine one where it
 * can, blends into the coarse one across the fine one's edge, and fades the
 * coarse one out at its own.
 */
export const CASCADES = [
  { size: 90, res: 2048, depth: 150 },
  { size: 360, res: 2048, depth: 260 },
];

/** The sun's view for each cascade, this frame. */
export function sunBoxes(eye, fwd, sunDir) {
  return CASCADES.map((c) => sunBox(eye, fwd, sunDir, c.size, c.res, c.depth));
}

/** Where a world point lands in the sun's view: x and y from 0 to 1 across the map, and its depth from 0 to 1. */
export function toShadowMap(vp, p) {
  const X = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const Y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const Z = vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14];
  return [X * 0.5 + 0.5, Y * 0.5 + 0.5, Z * 0.5 + 0.5];
}

/**
 * Does a solid cast a shadow? Not a roof (under one, the level's "sun" is
 * the room's own light, and a roof would put the whole room in shade), not a
 * lamp, not glass, and not what is never drawn.
 */
export function casts(s) {
  return !(s.invisible || s.glass || s.role === 'roof' || s.mat === 'lamp' || s.ghost);
}

export { sub };
