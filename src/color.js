// Colour arithmetic for the few places the game derives one colour from
// another: player colours kept clear of a level's own, and the light and dark
// hues of a player's wormholes. Hex colours only (#rgb or #rrggbb). Pure.

/** [r, g, b] from a hex colour, or null for anything else. */
export function parseHex(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** How far apart two colours look, 0 (the same) to about 441 (black and white); Infinity when either is not hex. */
export function colorDistance(a, b) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** `c` moved `k` (0..1) of the way to `to`. */
export function mix(c, to, k) {
  const x = parseHex(c);
  const y = parseHex(to);
  if (!x || !y) return c;
  return toHex(x.map((v, i) => v + (y[i] - v) * k));
}

export const lighter = (c, k = 0.45) => mix(c, '#ffffff', k);
export const darker = (c, k = 0.45) => mix(c, '#000000', k);

/** One end of a player's wormhole pair: their colour made lighter (the first end, Q / LB) or darker (the second, E / RB). */
export const portalHue = (c, which) => (which === 0 ? lighter(c, 0.45) : darker(c, 0.35));
