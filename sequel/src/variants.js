// Defector's puzzles never repeat. Each kind has its variants here, gentlest
// first, and each changes something the answer turns on: how high the gap
// under a bulkhead is and how thick its wall, which way a chasm's far side
// lies, where a vault's second end has to go, how tall and narrow a chimney
// is, where a black hole hangs. Across the whole game, in the order it is
// played, each puzzle takes the next variant of its kind that nothing has
// taken yet. One written out by hand in a level keeps its own, and nothing
// else takes that. Every variant is solved in the real game by the tests.

export const VARIANTS = {
  bulkhead: [
    {},
    { gap: 1.1, room: 5 },
    { gap: 1.45, thick: 3, room: 7 },
    { gap: 1.2, room: 7, pillar: 4 },
    { gap: 1.3, thick: 3, room: 5, pillar: 4, drop: 1 },
    { gap: 1.1, thick: 3, room: 6, drop: 2 },
    { gap: 1.45, room: 8, pillar: 4, drop: 1 },
    { gap: 1.2, thick: 4, room: 6 },
    { gap: 1.3, room: 6, pillar: 4, drop: 2 },
    { gap: 1.1, thick: 4, room: 8, pillar: 4, drop: 1 },
  ],
  chasm: [
    { w: 13, land: 6, up: 3 },
    { w: 14, land: 7, up: 4 },
    { w: 15, land: 8, up: 3, farUp: -2 },
    { w: 16, land: 6, up: 4, farUp: 1 },
    { w: 14, land: 8, up: 4, farUp: -3 },
    { w: 13, land: 7, up: 3, farUp: 2 },
    { w: 15, land: 6, up: 4 },
    { w: 16, land: 8, up: 3, farUp: -1 },
  ],
  skylight: [
    {},
    { up: 8, hole: 4, cave: 14 },
    { up: 7, hole: 4, cave: 18, step: 4, land: 5 },
    { up: 8, cave: 16, step: 4, land: 5 },
    { up: 9, hole: 4, cave: 14, land: 4 },
    { cave: 14, step: 4, land: 4 },
    { up: 8, hole: 4, cave: 18 },
  ],
  vault: [
    {},
    { via: 'behind' },
    { inner: 4.5, stand: 8 },
    { via: 'floor' },
    { slant: true },
    { slant: true, via: 'behind' },
    { via: 'floor', inner: 4.5, stand: 7 },
    { slant: true, via: 'floor', stand: 9 },
  ],
  chimney: [
    {},
    { height: 5 },
    { half: 0.9, height: 3 },
    { half: 0.6, spikes: 5 },
    { roof: 6 },
    { roof: 6, height: 3, half: 0.6, stand: 7 },
    { height: 5, spikes: 5, stand: 6 },
  ],
  orbit: [
    {},
    { hole: { dx: 1.5, up: 8, range: 4.5, pull: 650000 }, at: 3, behind: 7 },
    { hole: { dx: 2.5, up: 9.5, range: 5, pull: 720000 }, at: 4.5 },
    { hole: { dx: 3, up: 10, range: 5.5, pull: 750000 }, at: 5 },
  ],
  switchdoor: [
    { stand: 8 },
    { hold: 5 },
    { at: 5, stand: 10 },
    { hold: 3, at: 2, stand: 8 },
    { roof: 6, at: 6, stand: 12 },
    { roof: 6, hold: 4, at: 9, stand: 14 },
    { at: 1.5, stand: 6, roof: 6 },
    { roof: 7, at: 4, stand: 9, hold: 6 },
  ],
  relay: [
    {},
    { d1: [7, 8.25], d2: [5.5, 6.75], room1: 11 },
    { room1: 9, room2: 11, hold1: 5, hold2: 5 },
    { d1: [7.5, 8.75], room1: 12, s2: 3 },
  ],
  launch: [
    {},
    { h: 3, w: 11, up: 5 },
    { slope: 1.5, w: 10 },
    { h: 2.5, w: 9, up: 4.5, pad: 4 },
    { h: 3, slope: 1.5, w: 10, up: 5 },
  ],
  // An ambush room whose enemies are folded: its size (20 to 24 tiles by 7 to 9) and its platforms.
  foldroom: [
    {},
    { len: 24, roof: 9, list: [[3, 3, 5], [16, 3, 5], [9.5, 6, 5]] },
    { len: 20, roof: 7, list: [[7, 3.5, 6]] },
    { len: 24, roof: 8, list: [[3, 2.5, 4], [10, 5, 4], [17, 2.5, 4]] },
    { len: 22, roof: 9, list: [[2, 3, 4], [16, 3, 4], [9, 6, 4]] },
    { len: 24, roof: 7, list: [[4, 3, 3], [10.5, 3, 3], [17, 3, 3]] },
    { len: 20, roof: 9, list: [[2, 4, 4], [14, 4, 4], [8, 7, 4]] },
    { len: 22, roof: 7, list: [[5, 3, 5], [13, 3, 5]] },
    { len: 24, roof: 9, list: [[6, 3, 4], [15, 3, 4], [10.5, 6, 4], [1, 6, 3], [20, 6, 3]] },
  ],
};

/** What makes one of a kind the same as another: these, with their defaults (as the builder has them). */
export const KEYS = {
  bulkhead: { gap: 1.3, thick: 2, room: 6, pillar: 3, drop: 0, tall: 11 },
  chasm: { w: 14, land: 7, up: 4, farUp: 0 },
  skylight: { up: 7, hole: 3, cave: 16, step: 3, land: 3 },
  vault: { via: 'roof', inner: 3.5, stand: 6, slant: false },
  chimney: { height: 4, half: 0.75, roof: 5, spikes: 4, stand: 5 },
  orbit: { hole: { dx: 2, up: 9, range: 5, pull: 700000 }, at: 4, behind: 8 },
  switchdoor: { stand: 8, at: 3, hold: 0, roof: 5 },
  relay: { d1: [6.5, 7.75], d2: [5, 6.25], room1: 10, room2: 10, s1: 3, s2: 1.5, hold1: 6, hold2: 6, ceil: 10 },
  launch: { h: 2, slope: 1, w: 11, up: 4, pad: 3 },
  foldroom: { len: 22, roof: 8, list: [[4, 3, 4], [14, 3, 4], [9, 5.5, 4]] },
};

/** The puzzle kind a section is, or null: a folded ambush room counts as one. */
export function kindOf([type, p]) {
  if (type === 'ambush') return p && p.folded ? 'foldroom' : null;
  return KEYS[type] ? type : null;
}

/** A puzzle's shape as a string: two with the same are the same puzzle. */
export function signature(kind, p) {
  const out = {};
  for (const [k, d] of Object.entries(KEYS[kind])) out[k] = p[k] ?? d;
  return `${kind} ${JSON.stringify(out)}`;
}

/**
 * Give every puzzle in the game its variant. `levels` is each level's
 * sections, in the order they are played; `auto` holds the params the seeded
 * run wrote, whose shape is the plan's to choose. Returns a Map from
 * `${level index}:${section index}` to the params to lay over that section's.
 */
export function planVariants(levels, auto) {
  const used = new Set();
  const todo = [];
  levels.forEach((sections, li) =>
    sections.forEach((s, si) => {
      const kind = kindOf(s);
      if (!kind) return;
      const p = s[1] || {};
      const own = !auto.has(p) && Object.keys(KEYS[kind]).some((k) => p[k] !== undefined);
      if (own) used.add(signature(kind, p));
      else todo.push([li, si, kind]);
    }),
  );
  const plan = new Map();
  for (const [li, si, kind] of todo) {
    const v = VARIANTS[kind].find((c) => !used.has(signature(kind, c)));
    if (!v) throw new Error(`no ${kind} left for level ${li + 1}: every one of its ${VARIANTS[kind].length} variants is taken`);
    used.add(signature(kind, v));
    plan.set(`${li}:${si}`, { ...KEYS[kind], ...v });
  }
  return plan;
}
