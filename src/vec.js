// Small vector / math helpers shared by physics, AI and rendering.
export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle into the range (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Signed shortest rotation that takes angle `from` to angle `to`. */
export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

export function lerpAngle(a, b, t) {
  return wrapAngle(a + angleDiff(a, b) * t);
}

/** Move `cur` toward `target` by at most `maxDelta`. */
export function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

export function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}
