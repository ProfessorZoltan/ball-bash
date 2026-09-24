// The parts the courses are built from, for drafting a hole in a module of its
// own before it goes into src/golf.js. A draft exports its hole as `def`, and
// every tool here takes the draft's path wherever it takes a hole id:
//
//   node tools/golf/sweep.mjs tools/golf/draft-example.mjs
//   node tools/golf/plot.mjs tools/golf/draft-example.mjs draft.png
//
// farHole() makes the same object FAR_COURSE holds, so a finished draft moves
// into the course as it is.
import { PARTS } from '../../src/golf.js';

export { rect } from '../../src/levels.js';
export { fly, R } from './fly.mjs';
export const { hole, farHole, planet, maw, fount, cup, cage, warp, binary, oneWay, orbitingWarp, slots, room, ROOM, SCREEN, GOLD } = PARTS;
