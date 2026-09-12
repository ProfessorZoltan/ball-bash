// Frames: the shape a player wears in the grid.
//
// The mark has four readings, and each one is a frame. Three are cut for you
// (Reflector, Deflector, Defector); the fourth, Vector, is the one you cut
// yourself. Every frame is built from the same eight cells spread across four
// systems, so no frame is richer than another: a wider shield is paid for
// with a bigger hull to hit, speed is paid for with something else.
//
//   Drive  how fast the frame moves
//   Gyro   how fast it turns (and so how hard a swung shield whacks)
//   Span   the width of the shield
//   Hull   the size of the body the ball has to find. This one runs the other
//          way: cells spent on Hull make it smaller, and a frame that spends
//          nothing there carries the biggest target in the game.
//
// Nothing else about a frame changes: the thrust, the pull-in and the rules
// are the same for everyone, and AI bosses have their own stats entirely.
import { PLAYER } from './config.js';

/** Cells every frame has to spend. Four systems, five tiers each (0 to 4). */
export const FRAME_CELLS = 8;
export const TIERS = 5;

/**
 * The four systems. `values` is indexed by the cells spent on it, so
 * values[0] is what you get for nothing and values[4] for four cells.
 */
export const SYSTEMS = [
  {
    key: 'drive',
    name: 'Drive',
    unit: 'px/s',
    stat: 'moveSpeed',
    blurb: 'how fast the frame moves',
    values: [340, 385, 430, 475, 520],
  },
  {
    key: 'gyro',
    name: 'Gyro',
    unit: 'rad/s',
    stat: 'turnSpeed',
    decimals: 1,
    blurb: 'how fast it turns, and how hard a swing whacks',
    values: [5.6, 6.3, 7.0, 7.7, 8.4],
  },
  {
    key: 'span',
    name: 'Span',
    unit: 'px',
    stat: 'paddleWidth',
    blurb: 'the width of the shield',
    values: [92, 104, 116, 128, 140],
  },
  {
    key: 'hull',
    name: 'Hull',
    unit: 'px',
    stat: 'radius',
    smaller: true, // more cells, smaller body: the readout goes down as the pips go up
    blurb: 'the size of the body the ball has to hit — cells here shrink it',
    values: [28, 25, 22, 19, 16],
  },
];

/** The biggest body any frame can carry: spawn placement leaves room for it. */
export const MAX_HULL = Math.max(...SYSTEMS.find((s) => s.key === 'hull').values);

/** The standard allocation: every system at its middle tier. This is the game as it was before frames. */
export const STANDARD = Object.freeze({ drive: 2, gyro: 2, span: 2, hull: 2 });

/** The three cut frames. The fourth reading, Vector, is whatever you make it. */
export const FRAMES = [
  {
    id: 'reflector',
    name: 'Reflector',
    cells: { drive: 2, gyro: 2, span: 2, hull: 2 },
    blurb: 'Even in every system',
    lore: 'Sends it back the way it came. The frame the grid was written for, and the one every room was drawn around: nothing it does is remarkable, and nothing it does is a weakness.',
  },
  {
    id: 'deflector',
    name: 'Deflector',
    cells: { drive: 2, gyro: 2, span: 4, hull: 0 },
    blurb: 'The widest shield, on the biggest hull',
    lore: 'Does not send it back, sends it away. Its shield covers lanes no other frame reaches, and it pays for every one of them by being the easiest thing in the room to hit — and by finding the boss with a shoulder it never meant to offer.',
  },
  {
    id: 'defector',
    name: 'Defector',
    cells: { drive: 3, gyro: 2, span: 0, hull: 3 },
    blurb: 'Quick, and barely there',
    lore: 'Does not take the shot at all. A small hull is hard to find and quick to move, which is the whole of its defence: what it carries to block with is little more than a line.',
  },
];

export const CUSTOM_ID = 'vector';
export const DEFAULT_FRAME = 'reflector';

/** The custom frame, wrapped around an allocation. */
export function vectorFrame(cells) {
  return {
    id: CUSTOM_ID,
    name: 'Vector',
    custom: true,
    cells: normalizeCells(cells),
    blurb: 'Your own allocation',
    lore: 'Direction and magnitude, nothing else. Eight cells and four systems: what the frame is, you decide, and the grid does not care which way you spend them.',
  };
}

/** Every frame that can be chosen, the custom one last. */
export function allFrames(customCells) {
  return FRAMES.concat(vectorFrame(customCells));
}

export function frameById(id, customCells) {
  return allFrames(customCells).find((f) => f.id === id) || null;
}

/** Cells clamped to the tiers; anything missing takes the standard tier. */
export function normalizeCells(cells) {
  const out = {};
  for (const s of SYSTEMS) {
    const v = Math.round(Number(cells && cells[s.key]));
    out[s.key] = Number.isFinite(v) ? Math.max(0, Math.min(TIERS - 1, v)) : STANDARD[s.key];
  }
  return out;
}

/** Cells spent. A legal frame spends exactly FRAME_CELLS. */
export function cellsSpent(cells) {
  return SYSTEMS.reduce((n, s) => n + (cells[s.key] || 0), 0);
}

export function isLegal(cells) {
  const c = normalizeCells(cells);
  return cellsSpent(c) === FRAME_CELLS && SYSTEMS.every((s) => c[s.key] === (cells[s.key] || 0));
}

/**
 * An allocation brought inside the budget: cells are trimmed from the richest
 * system until no more than FRAME_CELLS are spent. A saved frame from an older
 * build, a hand-edited one or a guest's claim over the network can never buy
 * more than anyone else. Spending *less* is left alone: it only costs you, and
 * a half-built frame in the editor has to be allowed to stay half-built while
 * its cells are moved around.
 */
export function withinBudget(cells) {
  const c = normalizeCells(cells);
  let guard = 64;
  while (cellsSpent(c) > FRAME_CELLS && guard-- > 0) {
    const k = SYSTEMS.map((s) => s.key).reduce((a, b) => (c[b] > c[a] ? b : a));
    c[k]--;
  }
  return c;
}

/** The stat block a frame gives a human fighter. The shield keeps its gap from the hull, so it sits right on any body. */
export function frameStats(cells) {
  const c = withinBudget(cells);
  const value = (key) => SYSTEMS.find((s) => s.key === key).values[c[key]];
  const radius = value('hull');
  return {
    radius,
    paddleWidth: value('span'),
    paddleBase: radius + PLAYER.paddleGap,
    paddleThick: PLAYER.paddleThick,
    moveSpeed: value('drive'),
    turnSpeed: value('gyro'),
    lungeExtend: PLAYER.lungeExtend,
    lungeSpeed: PLAYER.lungeSpeed,
    retractPull: PLAYER.retractPull,
  };
}

/** The readout for one system: its value on this frame, and how it reads. */
export function systemValue(system, cells) {
  const v = system.values[withinBudget(cells)[system.key]];
  return system.decimals ? v.toFixed(system.decimals) : String(v);
}
