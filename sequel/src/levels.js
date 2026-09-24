// Defector's ten levels. Each is written as a handful of hand-placed
// sections that teach what is new (with signs on the early levels), then a
// seeded run of set pieces drawn from the level's own palette, getting
// harder toward the end, then the boss. The run is seeded, so a level is the
// same every time it is built; change its seed and it is a different level.
//
// Lengths follow the design: early levels about 3 to 5 minutes before the
// boss, the middle ones 4 to 8, the late ones 8 to 15 (estimateSeconds in
// build.js is the yardstick, and a test holds each level to its band).
import { buildLevel, seeded, LIMITS } from './build.js';
import { KINDS } from './enemies.js';

// ------------------------------------------------------------------ themes
// The look of each level: the sky, the ground and its neon edge, what grows
// or stands on it (props), and the far layer behind it all.

export const THEMES = {
  orchard: {
    sky: ['#1a0b3d', '#5b1f6e', '#ff8a5b'],
    sun: '#ffcf6b',
    ground: '#120a24',
    edge: '#9dff5c',
    edge2: '#ff7eb6',
    grid: 'rgba(157, 255, 92, 0.10)',
    far: 'orchard',
    props: ['tree', 'tree', 'bush', 'lamp', 'fence', 'house'],
    accent: '#ffcf6b',
  },
  market: {
    sky: ['#050a1f', '#1d1446', '#3b1a5c'],
    sun: '#ff4fd8',
    ground: '#0b0a1c',
    edge: '#ff4fd8',
    edge2: '#5ce1ff',
    grid: 'rgba(255, 79, 216, 0.09)',
    far: 'city',
    props: ['lantern', 'awning', 'sign', 'vending', 'lamp'],
    accent: '#ffe27a',
    rain: true,
  },
  transit: {
    sky: ['#07122a', '#0d3a5c', '#ff9e5e'],
    sun: '#ffb347',
    ground: '#0a1020',
    edge: '#ffb347',
    edge2: '#7fe9ff',
    grid: 'rgba(255, 179, 71, 0.09)',
    far: 'rails',
    props: ['pylon', 'bench', 'sign', 'lamp', 'rail'],
    accent: '#7fe9ff',
  },
  tide: {
    sky: ['#03122b', '#0c4a6e', '#5ee0c9'],
    sun: '#f4f1c9',
    ground: '#06121c',
    edge: '#5ee0c9',
    edge2: '#ff9df5',
    grid: 'rgba(94, 224, 201, 0.10)',
    far: 'sea',
    props: ['palm', 'shell', 'buoy', 'rock', 'lamp'],
    accent: '#ff9df5',
  },
  greenhouse: {
    sky: ['#06200f', '#0f4b2e', '#b6ff8a'],
    sun: '#fff27a',
    ground: '#07160c',
    edge: '#7dff9a',
    edge2: '#ff7eb6',
    grid: 'rgba(125, 255, 154, 0.10)',
    far: 'dome',
    props: ['mushroom', 'flower', 'fern', 'sprinkler', 'mushroom'],
    accent: '#ff7eb6',
  },
  observatory: {
    sky: ['#02030d', '#12104a', '#3d2a7a'],
    sun: '#c9a2ff',
    ground: '#0a0a1c',
    edge: '#c9a2ff',
    edge2: '#7fe9ff',
    grid: 'rgba(201, 162, 255, 0.09)',
    far: 'peaks',
    props: ['telescope', 'dish', 'rock', 'crystal', 'lamp'],
    accent: '#7fe9ff',
  },
  carnival: {
    sky: ['#12031f', '#3d0b4f', '#ff4f8b'],
    sun: '#ffd23f',
    ground: '#14061c',
    edge: '#ffd23f',
    edge2: '#ff4fd8',
    grid: 'rgba(255, 210, 63, 0.09)',
    far: 'carnival',
    props: ['tent', 'balloon', 'lamp', 'booth', 'balloon'],
    accent: '#5ce1ff',
  },
  deep: {
    sky: ['#000308', '#021a2e', '#04384a'],
    sun: '#aef6ff',
    ground: '#020a10',
    edge: '#3ef0ff',
    edge2: '#b98cff',
    grid: 'rgba(62, 240, 255, 0.07)',
    far: 'deep',
    props: ['kelp', 'coral', 'cable', 'kelp', 'vent'],
    accent: '#b98cff',
  },
  folded: {
    sky: ['#0b0520', '#2a0f4f', '#0f6b8f'],
    sun: '#5ce1ff',
    ground: '#0a0718',
    edge: '#5ce1ff',
    edge2: '#ffb347',
    grid: 'rgba(92, 225, 255, 0.10)',
    far: 'folded',
    props: ['tower', 'sign', 'lamp', 'monolith', 'rail'],
    accent: '#ffb347',
  },
  source: {
    sky: ['#000000', '#101030', '#40106a'],
    sun: '#ffffff',
    ground: '#05050c',
    edge: '#ffffff',
    edge2: '#7fe9ff',
    grid: 'rgba(255, 255, 255, 0.08)',
    far: 'source',
    props: ['monolith', 'crystal', 'totem', 'tree', 'tower'],
    accent: '#ff4fd8',
  },
};

// ------------------------------------------------------------------ pieces
// The set pieces a level's run is drawn from. `d` is 0 to 1: how far into
// the run the piece falls, blended with the level's own difficulty.

const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pickW = (rng, weights) => {
  const entries = Object.entries(weights);
  let sum = 0;
  for (const [, w] of entries) sum += w;
  let u = rng() * sum;
  for (const [k, w] of entries) {
    u -= w;
    if (u <= 0) return k;
  }
  return entries[entries.length - 1][0];
};

/** A few enemies from the level's roster for a stretch `len` tiles long. */
function foes(rng, L, len, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = pickW(rng, L.roster);
    const k = KINDS[kind];
    const air = ['fly', 'zigzag', 'swoop'].includes(k.move);
    const dx = 2 + ((len - 4) * (i + 0.5 + rng() * 0.5)) / Math.max(1, n);
    const opts = {};
    if (rng() < L.dropRate) opts.drop = 'random';
    if (k.move === 'fly' && rng() < 0.4) {
      opts.axis = 'y';
      opts.range = 90;
    }
    if (k.move === 'walk' || k.move === 'run') opts.dir = rng() < 0.8 ? -1 : 1;
    out.push([kind, Math.round(dx * 2) / 2, air ? (k.move === 'swoop' ? 5.5 : 2.5 + rng() * 2) : 0, opts]);
  }
  return out;
}

const PIECES = {
  run: (rng, d, L) => {
    const len = ri(rng, 9, 15);
    return ['flat', { len, e: foes(rng, L, len, 1 + (rng() < d ? 1 : 0) + (rng() < d * 0.5 ? 1 : 0)) }];
  },
  hop: (rng, d, L) => {
    const up = [0, 0, 1, -1, -2][ri(rng, 0, 4)];
    const w = Math.min(up > 0 ? 3 : LIMITS.gapWalk, 2 + Math.round(d * 2 + rng()));
    return ['gap', { w, up, run: 2, land: 4, e: rng() < 0.4 + d * 0.3 ? foes(rng, L, 6, 1) : [] }];
  },
  long: (rng, d) => ['gap', { w: Math.min(LIMITS.gapRun, 5 + Math.round(d * 3) * 0.5), run: 7, land: 4, runUp: true }],
  stairs: (rng, d, L) => {
    const down = rng() < 0.4;
    return ['stairs', { n: ri(rng, 3, 5), rise: down ? -1 : ri(rng, 1, 2), tread: 2, after: 4, e: rng() < 0.5 ? foes(rng, L, 8, 1) : [] }];
  },
  pillars: (rng, d, L) => {
    const n = ri(rng, 2, 4);
    const h = Array.from({ length: n }, () => ri(rng, 2, 4));
    return ['pillars', { h, space: ri(rng, 3, 5), w: 2, e: foes(rng, L, n * 6, 1 + (rng() < d ? 1 : 0)) }];
  },
  bricks: (rng, d, L) => {
    const n = ri(rng, 3, 6);
    const list = [];
    const start = 3;
    for (let i = 0; i < n; i++) {
      const crate = rng() < 0.45;
      list.push([start + i * 2, 4, 2, 1, crate ? 'crate' : 'block', crate && rng() < 0.6 ? 'random' : null, 1]);
    }
    if (rng() < 0.5) list.push([start + 2, 8, 2 * (n - 2), 1, 'thin']);
    return ['blocks', { len: start + n * 2 + 4, list, e: foes(rng, L, n * 2 + 6, 1) }];
  },
  plats: (rng, d) => {
    const w = ri(rng, 8, 11);
    const n = w > 9 ? 3 : 2;
    const list = [];
    for (let i = 0; i < n; i++) list.push([(w / (n + 1)) * (i + 1) - 1, ri(rng, 1, 3), 2.5, rng() < 0.5]);
    return ['plats', { w, list, land: 4 }];
  },
  mover: (rng, d, L) => {
    const path = L.movers[ri(rng, 0, L.movers.length - 1)];
    if (path === 'v') return ['mover', { path, w: 8, len: 3, rise: 4, up: ri(rng, 2, 4), period: 4.5 }];
    if (path === 'fall') return ['mover', { path, w: ri(rng, 9, 12), n: 3, len: 2.4 }];
    if (path === 'circle') return ['mover', { path, w: 9, len: 3, R: 2.2, period: 6 }];
    return ['mover', { path: 'h', w: ri(rng, 8, 12), len: 3, period: 4 + rng() * 2, thin: rng() < 0.5 }];
  },
  climb: (rng) => ['climb', { up: 3 * ri(rng, 2, 4), width: 8, after: 4 }],
  drop: (rng) => ['drop', { down: ri(rng, 4, 8), after: 5 }],
  spikes: (rng, d) => (rng() < 0.5 ? ['spikes', { len: ri(rng, 2, 4) }] : ['spikes', { len: 8, list: [[2.5, 1.5, 3]] }]),
  tunnel: (rng, d, L) => ['tunnel', { len: ri(rng, 10, 16), h: 3.5, e: foes(rng, { ...L, roster: L.ground }, 12, 1 + (rng() < d ? 1 : 0)) }],
  crushers: (rng, d) => ['crushers', { n: ri(rng, 2, 4), space: 5, period: 3.2 - d * 0.6, roof: 5 }],
  laser: (rng, d) => ['laser', { len: ri(rng, 8, 12), n: ri(rng, 1, 2), period: 3, on: 1.2 + d * 0.4, roof: 5 }],
  glass: (rng) => ['glass', { n: ri(rng, 1, 3), len: 10, hp: 2, drop: rng() < 0.4 ? 'random' : null }],
  pulse: (rng, d, L) => ['pulse', { len: ri(rng, 12, 16), period: 3.4 - d * 0.6, e: foes(rng, L, 12, 1) }],
  well: (rng, d, L) => {
    const w = ri(rng, 6, 8);
    // Its moons: one, two once the run is hard, from the level's own fliers. They come
    // from a generator of their own, so the rest of the run is laid as it always was.
    const own = seeded(L.seed * 97 + w + Math.round(d * 1000));
    const fliers = Object.fromEntries(Object.entries(L.roster).filter(([k]) => ['fly', 'zigzag'].includes(KINDS[k].move) && !KINDS[k].folded));
    const quiet = Object.fromEntries(Object.entries(fliers).filter(([k]) => !KINDS[k].shoot));
    const moons = [];
    for (let i = 0; i < (d >= 0.6 ? 2 : 1) && Object.keys(fliers).length; i++) {
      // At most one of them shoots: the other is one of the level's quiet fliers, or a drifter.
      const pool = i && KINDS[moons[0][0]].shoot ? (Object.keys(quiet).length ? quiet : { drifter: 1 }) : fliers;
      moons.push([pickW(own, pool), { drop: own() < L.dropRate ? 'random' : null }]);
    }
    return ['well', { w, depth: 2.5, range: 9, pull: 330000 + d * 120000, list: [[w / 2 - 1, 0.5, 2]], moons }];
  },
  fount: (rng) => ['fount', { w: ri(rng, 9, 11), push: 900000, depth: 2, range: 10 }],
  phase: (rng, d) => ['phase', { w: 11, n: 3, on: 2.6 - d * 0.4, off: 1.2, up: 1 }],
  spring: (rng) => ['spring', { up: ri(rng, 6, 8), run: 5, after: 4 }],
  slope: (rng, d, L) => ['slope', { len: ri(rng, 4, 8), up: [2, 1, -1, -2, 3][ri(rng, 0, 4)], after: 3, e: rng() < 0.5 ? foes(rng, L, 8, 1) : [] }],
  bulkhead: (rng, d, L) => ['bulkhead', { run: 6, room: ri(rng, 5, 7), pillar: 3, e: rng() < 0.5 ? [['skitter', 9]] : [] }],
  chasm: (rng, d, L) => ['chasm', { w: ri(rng, 13, 16), land: ri(rng, 6, 8), up: ri(rng, 3, 4), e: rng() < 0.5 ? foes(rng, { ...L, roster: L.air || L.roster }, 12, 1) : [] }],
  foldroom: (rng, d, L) => {
    const kinds = ['wraith', 'echo', 'shade'];
    const waves = [];
    for (let i = 0; i < 2; i++) waves.push(Array.from({ length: 2 + Math.round(d) }, (_, j) => [kinds[(i + j) % 3], 5 + j * 6, kinds[(i + j) % 3] === 'echo' ? 0 : 3 + (j % 2) * 2]));
    return ['ambush', { len: 22, roof: 8, list: [[4, 3, 4], [14, 3, 4], [9, 5.5, 4]], waves, drop: 'random', folded: true }];
  },
  ambush: (rng, d, L) => {
    const waves = [];
    const n = 2 + (d > 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) waves.push(foes(rng, L, 20, 2 + Math.round(d * 2)));
    return ['ambush', { len: 22, roof: 8, list: [[4, 3, 4], [14, 3, 4], [9, 5.5, 4]], waves, drop: 'random' }];
  },
};

const PUZZLES = ['bulkhead', 'chasm', 'foldroom'];

/**
 * A level's seeded run: `count` pieces from its palette, harder toward the
 * end, with a checkpoint every `every` pieces and secrets at the fractions
 * listed in `secretsAt`.
 */
function compose(L) {
  const rng = seeded(L.seed);
  const out = [];
  let since = 0;
  const secrets = [...(L.secretsAt || [])];
  let puzzles = 0;
  let prev = null;
  for (let i = 0; i < L.count; i++) {
    const u = i / Math.max(1, L.count - 1);
    const d = Math.min(1, L.base + (L.top - L.base) * u);
    if (secrets.length && u >= secrets[0].at) {
      const s = secrets.shift();
      out.push(['secret', { kind: s.kind, reward: s.reward, up: s.up }]);
    }
    // No piece twice running, and only so many wormhole puzzles a level.
    let kind = pickW(rng, L.pieces);
    for (let tries = 0; tries < 20 && (kind === prev || (PUZZLES.includes(kind) && puzzles >= (L.puzzles ?? 2))); tries++) kind = pickW(rng, L.pieces);
    if (PUZZLES.includes(kind) && puzzles >= (L.puzzles ?? 2)) kind = 'run';
    if (PUZZLES.includes(kind)) puzzles++;
    prev = kind;
    out.push(PIECES[kind](rng, d, L));
    // Breathing room: a stretch of floor after anything with a pit in it.
    if (['hop', 'long', 'plats', 'mover', 'well', 'fount', 'phase', 'spikes', 'chasm', 'bulkhead'].includes(kind)) out.push(['flat', { len: ri(rng, 3, 5) }]);
    since++;
    if (since >= L.every && i < L.count - 2) {
      out.push(['checkpoint', {}]);
      since = 0;
    }
  }
  return out;
}

// A sign's words for each input: the keyboard's and the controller's.
const say = (kb, pad) => ({ kb, pad });

// ------------------------------------------------------------------ levels

export const LEVEL_DEFS = [
  {
    id: 1,
    title: 'Neon Orchard',
    boss: 'gardener',
    track: 'orchard',
    theme: THEMES.orchard,
    tier: 'early',
    intro: 'Outside the grid at last: an orchard at the edge of a town, its trees lit like circuit boards. The lawns are kept. The Gardener keeps them.',
    record: 'The first thing past the wall of the grid was grass. The Defector had never walked on anything that did not reflect.',
    seed: 101,
    base: 0.05,
    top: 0.45,
    count: 26,
    every: 9,
    puzzles: 0, // wormhole puzzles in the seeded run
    dropRate: 0.18,
    roster: { skitter: 5, hopper: 2, flitter: 2, drifter: 1 },
    ground: { skitter: 4, hopper: 1 },
    movers: ['h'],
    pieces: { run: 5, hop: 4, stairs: 2, pillars: 3, bricks: 3, slope: 2, plats: 1, long: 1, drop: 1, climb: 1 },
    secretsAt: [{ at: 0.3, kind: 'cellar', reward: ['big', 'strong'] }, { at: 0.7, kind: 'sky', reward: ['triple', 'shield'] }],
    opening: [
      ['sign', { text: say('A D move · SPACE jumps: hold it to go higher', 'LEFT STICK moves · A jumps: hold it to go higher') }],
      ['flat', { len: 6 }],
      ['gap', { w: 2, land: 3 }],
      ['pillars', { h: [2, 3], space: 3 }],
      ['sign', { text: say('Hold 2 while moving to run: a running jump goes further', 'Hold X while moving to run: a running jump goes further') }],
      ['gap', { w: 5, run: 8, land: 4 }],
      ['sign', { text: say('Aim with the MOUSE or the ARROWS: the dotted line is where a shot goes · LEFT CLICK or / fires', 'Aim with the RIGHT STICK: the dotted line is where a shot goes · RT fires') }],
      ['flat', { len: 12, e: [['skitter', 8], ['skitter', 11]] }],
      ['sign', { text: say('Charges bounce off walls, like the ball always did. Stomp the little ones', 'Charges bounce off walls, like the ball always did. Stomp the little ones') }],
      ['blocks', { len: 14, list: [[3, 4, 2, 1, 'crate', 'triple', 1], [5, 4, 2, 1, 'block'], [7, 4, 2, 1, 'crate', null, 1]], e: [['hopper', 10]] }],
      ['sign', { text: say('Crates break, and some hold power-ups · 1 changes what the blaster fires', 'Crates break, and some hold power-ups · LT changes what the blaster fires') }],
      ['flat', { len: 8, e: [['flitter', 5, 3]] }],
      ['sign', { text: say('Q and E open wormhole ends where the aim line meets a wall · walk into one, out of the other', 'LB and RB open wormhole ends where the aim line meets a wall · walk into one, out of the other') }],
      ['secret', { kind: 'loft', up: 8, reward: ['freeze', 'durable'] }],
      ['checkpoint', {}],
    ],
  },
  {
    id: 2,
    title: 'Rain Market',
    boss: 'moth',
    track: 'market',
    theme: THEMES.market,
    tier: 'early',
    intro: 'A night market under a warm rain: awnings to hop across, carts that drift on their own, and a moth the size of a stall circling every lantern.',
    record: 'Nobody at the market asked where the robot came from. Half of them were programs too; the other half were selling umbrellas.',
    seed: 202,
    base: 0.2,
    top: 0.55,
    count: 26,
    every: 9,
    puzzles: 1, // wormhole puzzles in the seeded run
    dropRate: 0.18,
    roster: { skitter: 3, drifter: 3, flitter: 3, dasher: 2, hopper: 2, sentry: 1, moth: 1 },
    ground: { skitter: 3, dasher: 2, hopper: 1 },
    movers: ['h', 'v'],
    pieces: { run: 4, hop: 3, plats: 3, mover: 3, tunnel: 2, bricks: 2, stairs: 2, slope: 1, climb: 2, drop: 1, pillars: 1, bulkhead: 1 },
    secretsAt: [{ at: 0.4, kind: 'loft', reward: ['strong', 'big'], up: 8 }, { at: 0.8, kind: 'cellar', reward: ['shield', 'freeze'] }],
    opening: [
      ['sign', { text: say('Thin awnings: jump up through them · hold S to drop down through', 'Thin awnings: jump up through them · hold DOWN to drop through') }],
      ['plats', { w: 9, list: [[2, 2, 3, true], [5.5, 3, 3, true]], land: 4 }],
      ['mover', { path: 'h', w: 10, len: 3, period: 4.5, thin: true }],
      ['flat', { len: 10, e: [['drifter', 6, 3], ['skitter', 8]] }],
      ['sign', { text: say('No way over and no way under? Aim a wormhole end under the wall at the pillar beyond, put the other in the floor at your feet, and step in', 'No way over and no way under? Aim a wormhole end under the wall at the pillar beyond, put the other in the floor at your feet, and step in') }],
      ['bulkhead', { run: 6, room: 6, pillar: 3 }],
    ],
  },
  {
    id: 3,
    title: 'Transit Loop',
    boss: 'conductor',
    track: 'transit',
    theme: THEMES.transit,
    tier: 'early',
    intro: 'The elevated loop at sunset. Doors that slam, gates that flash, and guards that carry shields: bank your shots round them.',
    record: 'The trains still run to a timetable nobody reads. The Conductor reads it aloud to the empty cars.',
    seed: 303,
    base: 0.3,
    top: 0.65,
    count: 24,
    every: 9,
    puzzles: 1, // wormhole puzzles in the seeded run
    dropRate: 0.2,
    roster: { dasher: 3, lancer: 2, sentry: 2, swooper: 2, skitter: 2, flitter: 1 },
    ground: { dasher: 3, lancer: 2, skitter: 2 },
    movers: ['h', 'fall'],
    pieces: { run: 4, hop: 3, crushers: 3, laser: 2, mover: 2, tunnel: 2, pillars: 2, stairs: 1, bricks: 2, climb: 1, long: 1, chasm: 1, bulkhead: 1 },
    secretsAt: [{ at: 0.35, kind: 'sky', reward: ['triple', 'strong'] }, { at: 0.75, kind: 'loft', reward: ['shield', 'durable'], up: 8 }],
    opening: [
      ['sign', { text: say('A shield turns your charge away: bank it off a wall into their back', 'A shield turns your charge away: bank it off a wall into their back') }],
      ['flat', { len: 14, e: [['lancer', 10]] }],
      ['crushers', { n: 2, space: 5, period: 3.2 }],
      ['laser', { len: 8, n: 1, period: 3, on: 1.2 }],
      ['sign', { text: say('Too far to jump. Put one end on the far wall, the other at your feet', 'Too far to jump. Put one end on the far wall, the other at your feet') }],
      ['chasm', { w: 14, land: 7, up: 4 }],
    ],
  },
  {
    id: 4,
    title: 'Tidepool Light',
    boss: 'keeper',
    track: 'tide',
    theme: THEMES.tide,
    tier: 'mid',
    intro: 'Rock pools under a lighthouse that turns all night. Its pulses roll out over the water and throw whatever they reach, you and your charges alike.',
    record: 'The lighthouse was a reflector once, like the Defector. It never stopped turning long enough to become anything else.',
    seed: 404,
    base: 0.3,
    top: 0.7,
    count: 40,
    every: 10,
    puzzles: 2, // wormhole puzzles in the seeded run
    dropRate: 0.2,
    roster: { crab: 3, drifter: 3, hopper: 2, urchin: 2, gunner: 2, swooper: 1 },
    ground: { crab: 3, hopper: 1 },
    movers: ['h', 'circle', 'v'],
    pieces: { run: 4, hop: 3, pulse: 3, spikes: 3, mover: 3, plats: 2, stairs: 1, bricks: 2, climb: 2, drop: 1, slope: 1, long: 1, chasm: 1, bulkhead: 1 },
    secretsAt: [{ at: 0.25, kind: 'cellar', reward: ['big', 'triple'] }, { at: 0.6, kind: 'loft', reward: ['strong', 'shield'], up: 8 }, { at: 0.85, kind: 'sky', reward: ['freeze', 'durable'] }],
    opening: [
      ['sign', { text: say('Pulses throw you outward: ride one across, or wait for it to pass', 'Pulses throw you outward: ride one across, or wait for it to pass') }],
      ['pulse', { len: 14, period: 3.4 }],
      ['spikes', { len: 3 }],
      ['mover', { path: 'circle', w: 9, len: 3, R: 2.2, period: 6 }],
    ],
  },
  {
    id: 5,
    title: 'Greenhouse Arcology',
    boss: 'bloom',
    track: 'greenhouse',
    theme: THEMES.greenhouse,
    tier: 'mid',
    intro: 'A greenhouse the size of a district, grown wild. Springs in the moss, glass to shoot through, and something at the far end that flowers when you are not looking.',
    record: 'The arcology fed the city until the city forgot it. It kept growing anyway, which is a kind of defection.',
    seed: 505,
    base: 0.35,
    top: 0.75,
    count: 42,
    every: 10,
    puzzles: 2, // wormhole puzzles in the seeded run
    dropRate: 0.2,
    roster: { hopper: 3, boing: 1, flitter: 3, moth: 2, burr: 2, trundle: 1, lancer: 2, echo: 1 },
    ground: { hopper: 2, burr: 2, trundle: 1, lancer: 1 },
    movers: ['v', 'h', 'fall'],
    pieces: { run: 4, hop: 3, spring: 3, glass: 3, mover: 2, plats: 2, bricks: 2, climb: 2, pillars: 2, slope: 1, stairs: 1, drop: 1, spikes: 1, bulkhead: 1, chasm: 1 },
    secretsAt: [{ at: 0.2, kind: 'sky', reward: ['strong', 'big'] }, { at: 0.55, kind: 'cellar', reward: ['shield', 'triple'] }, { at: 0.85, kind: 'loft', reward: ['freeze', 'durable'], up: 8 }],
    opening: [
      ['sign', { text: say('Springs throw you high · hold jump for higher still', 'Springs throw you high · hold A for higher still') }],
      ['spring', { up: 7, run: 5, after: 5 }],
      ['glass', { n: 2, len: 10, hp: 2 }],
      ['sign', { text: say('A folded thing is only half here: your charge passes through it, unless the charge has been through a wormhole first', 'A folded thing is only half here: your charge passes through it, unless the charge has been through a wormhole first') }],
      ['flat', { len: 16, e: [['echo', 12]] }],
    ],
  },
  {
    id: 6,
    title: 'Observatory Heights',
    boss: 'astronomer',
    track: 'observatory',
    theme: THEMES.observatory,
    tier: 'mid',
    intro: 'Up among the domes, the dark has holes in it. A black hole bends every jump and every shot that passes it, and a wormhole\'s line of sight bends with them.',
    record: 'The astronomers pointed their instruments up and the sky pointed something back. It has been charting them since.',
    seed: 606,
    base: 0.4,
    top: 0.8,
    count: 44,
    every: 10,
    puzzles: 2, // wormhole puzzles in the seeded run
    dropRate: 0.2,
    roster: { wisp: 2, swooper: 2, gunner: 2, lancer: 2, drifter: 2, hopper: 1, sentry: 1, wraith: 1 },
    ground: { lancer: 2, hopper: 1, sentry: 1 },
    movers: ['h', 'v', 'circle'],
    pieces: { run: 4, hop: 3, well: 3, fount: 2, mover: 2, plats: 2, climb: 2, stairs: 1, bricks: 2, spikes: 1, drop: 1, long: 1, slope: 1, chasm: 1, bulkhead: 1 },
    secretsAt: [{ at: 0.3, kind: 'loft', reward: ['durable', 'strong'], up: 8 }, { at: 0.6, kind: 'sky', reward: ['shield', 'big'] }, { at: 0.9, kind: 'cellar', reward: ['triple', 'freeze'] }],
    opening: [
      ['sign', { text: say('A black hole pulls you and your charges · the aim line bends with it · cross its horizon and it takes a shield', 'A black hole pulls you and your charges · the aim line bends with it · cross its horizon and it takes a shield') }],
      ['well', { w: 6, depth: 2.5, range: 8, pull: 300000, list: [[2, 0.5, 2]], moons: [['drifter']] }],
      ['flat', { len: 4 }],
      ['sign', { text: say('A white hole pushes: let it carry you over', 'A white hole pushes: let it carry you over') }],
      ['fount', { w: 9, push: 900000, depth: 2, range: 10 }],
    ],
  },
  {
    id: 7,
    title: 'Carnival of Echoes',
    boss: 'ringmaster',
    track: 'carnival',
    theme: THEMES.carnival,
    tier: 'mid',
    intro: 'A carnival that runs for nobody: wheels that turn, rooms that lock until the show is over, and a ringmaster who never stops juggling.',
    record: 'Every ride still runs. The music is the same four bars it was when the grid was built, played faster every year.',
    seed: 707,
    base: 0.45,
    top: 0.85,
    count: 40,
    every: 11,
    puzzles: 3, // wormhole puzzles in the seeded run
    dropRate: 0.22,
    roster: { boing: 1, flitter: 3, dasher: 2, gunner: 2, moth: 2, trundle: 1, hopper: 2, swooper: 1, shade: 1 },
    ground: { dasher: 2, trundle: 1, hopper: 2 },
    movers: ['circle', 'h', 'v', 'fall'],
    pieces: { run: 4, hop: 3, mover: 4, pulse: 2, spring: 2, ambush: 2, plats: 2, bricks: 2, climb: 2, pillars: 2, glass: 1, stairs: 1, spikes: 1, long: 1, foldroom: 1, chasm: 1, bulkhead: 1 },
    secretsAt: [{ at: 0.2, kind: 'cellar', reward: ['big', 'strong'] }, { at: 0.5, kind: 'sky', reward: ['shield', 'triple'] }, { at: 0.8, kind: 'loft', reward: ['freeze', 'durable'], up: 8 }],
    opening: [
      ['sign', { text: say('The doors lock until the room is clear', 'The doors lock until the room is clear') }],
      ['ambush', { len: 22, roof: 8, list: [[4, 3, 4], [14, 3, 4], [9, 5.5, 4]], waves: [[['hopper', 16], ['flitter', 12, 4]], [['dasher', 18], ['gunner', 6, 5]]], drop: 'random' }],
    ],
  },
  {
    id: 8,
    title: 'Deep Relay',
    boss: 'angler',
    track: 'deep',
    theme: THEMES.deep,
    tier: 'late',
    dark: true,
    intro: 'Down the undersea cable to where the signal is relayed. There is no light but yours, your charges\' and whatever glows on its own down here.',
    record: 'The relay carried every message the grid ever sent. It listened to all of them, and it has opinions.',
    seed: 808,
    base: 0.5,
    top: 0.9,
    count: 74,
    every: 12,
    puzzles: 3, // wormhole puzzles in the seeded run
    dropRate: 0.22,
    roster: { wisp: 2, urchin: 2, drifter: 3, gunner: 2, crab: 2, lancer: 1, flitter: 1, wraith: 1 },
    ground: { crab: 3, lancer: 1 },
    movers: ['v', 'h', 'circle', 'fall'],
    pieces: { run: 4, hop: 3, fount: 3, well: 2, crushers: 2, mover: 3, plats: 2, climb: 2, drop: 2, tunnel: 2, spikes: 2, bricks: 2, stairs: 1, pulse: 1, long: 1, chasm: 1, bulkhead: 1, foldroom: 1 },
    secretsAt: [{ at: 0.15, kind: 'loft', reward: ['durable', 'big'], up: 8 }, { at: 0.4, kind: 'cellar', reward: ['shield', 'strong'] }, { at: 0.65, kind: 'sky', reward: ['triple', 'freeze'] }, { at: 0.9, kind: 'cellar', reward: ['shield', 'big'] }],
    opening: [
      ['sign', { text: say('Dark water: your charges light the way', 'Dark water: your charges light the way') }],
      ['flat', { len: 10, e: [['drifter', 7, 3]] }],
    ],
  },
  {
    id: 9,
    title: 'Folded City',
    boss: 'cartographer',
    track: 'folded',
    theme: THEMES.folded,
    tier: 'late',
    intro: 'A city folded over itself, its avenues hung in the sky upside down. Platforms blink in and out of the fold, and the Cartographer opens wormholes of its own.',
    record: 'Someone drew a map of the city so accurate that the city started following it. Then the map started folding.',
    seed: 909,
    base: 0.55,
    top: 0.95,
    count: 80,
    every: 12,
    puzzles: 4, // wormhole puzzles in the seeded run
    dropRate: 0.22,
    roster: { lancer: 2, gunner: 2, sentry: 2, dasher: 2, swooper: 2, wisp: 2, trundle: 1, wraith: 1, echo: 1, shade: 1 },
    ground: { lancer: 2, dasher: 2, sentry: 1, trundle: 1 },
    movers: ['h', 'v', 'fall', 'circle'],
    pieces: { run: 4, hop: 3, phase: 3, well: 2, laser: 2, ambush: 1, glass: 2, mover: 2, crushers: 2, plats: 2, climb: 2, bricks: 2, drop: 1, stairs: 1, long: 1, spring: 1, foldroom: 2, chasm: 2, bulkhead: 2 },
    secretsAt: [{ at: 0.15, kind: 'sky', reward: ['strong', 'triple'] }, { at: 0.4, kind: 'loft', reward: ['shield', 'freeze'], up: 8 }, { at: 0.65, kind: 'cellar', reward: ['durable', 'big'] }, { at: 0.9, kind: 'sky', reward: ['shield', 'strong'] }],
    opening: [
      ['sign', { text: say('Blinking platforms: watch their rhythm before you trust them', 'Blinking platforms: watch their rhythm before you trust them') }],
      ['phase', { w: 11, n: 3, on: 2.6, off: 1.2, up: 1 }],
      ['sign', { text: say('The doors lock on folded things: open a wormhole in the room and fire through it', 'The doors lock on folded things: open a wormhole in the room and fire through it') }],
      ['ambush', { len: 22, roof: 8, list: [[4, 3, 4], [14, 3, 4], [9, 5.5, 4]], waves: [[['wraith', 8, 3], ['echo', 15]], [['shade', 11, 5], ['wraith', 16, 4]]], drop: 'random', folded: true }],
    ],
  },
  {
    id: 10,
    title: 'The Source',
    boss: 'administrator',
    track: 'source',
    theme: THEMES.source,
    tier: 'late',
    intro: 'Where the grid and the world are the same thing. Everything you have met is here again, and at the end, the program that runs the rest.',
    record: 'The Administrator was never a program the grid ran. It is the grid, and it has been waiting to see what the Defector would become.',
    seed: 1010,
    base: 0.6,
    top: 1,
    count: 80,
    every: 12,
    puzzles: 4, // wormhole puzzles in the seeded run
    dropRate: 0.24,
    roster: { lancer: 2, gunner: 2, dasher: 2, swooper: 2, wisp: 2, boing: 1, moth: 1, urchin: 1, crab: 1, sentry: 1, wraith: 1, shade: 1 },
    ground: { lancer: 2, dasher: 2, crab: 1, sentry: 1 },
    movers: ['h', 'v', 'circle', 'fall'],
    pieces: { run: 3, hop: 3, well: 2, fount: 2, phase: 2, pulse: 2, crushers: 2, laser: 2, ambush: 1, glass: 1, spring: 2, mover: 3, plats: 2, climb: 2, spikes: 2, bricks: 2, drop: 1, long: 1, tunnel: 1, foldroom: 2, chasm: 2, bulkhead: 2 },
    secretsAt: [{ at: 0.12, kind: 'cellar', reward: ['big', 'strong'] }, { at: 0.35, kind: 'sky', reward: ['shield', 'triple'] }, { at: 0.6, kind: 'loft', reward: ['freeze', 'durable'], up: 8 }, { at: 0.85, kind: 'cellar', reward: ['shield', 'strong'] }],
    opening: [
      ['sign', { text: say('The last level. Everything you know, all at once', 'The last level. Everything you know, all at once') }],
      ['flat', { len: 10, e: [['lancer', 8]] }],
    ],
  },
];

/** A level definition, ready for buildLevel: its opening, then its seeded run. */
export function levelDef(L) {
  return { ...L, floor: 0, sections: [...L.opening, ...compose(L)] };
}

const cache = new Map();

/** The built blueprint of level `id` (1-based), cached: building is deterministic. */
export function level(id) {
  if (!cache.has(id)) {
    const L = LEVEL_DEFS.find((l) => l.id === id);
    cache.set(id, buildLevel(levelDef(L)));
  }
  return cache.get(id);
}

/** The time bands the design asks for, in seconds before the boss. */
export const TIER_SECONDS = { early: [180, 300], mid: [240, 480], late: [480, 900] };
