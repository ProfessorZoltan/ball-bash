// Solving a wormhole puzzle the way a player would, in the real game: stand
// at the near side, sweep the aim until the line of sight lands on the far
// wall, open the dark end there, point at the floor underfoot, open the
// light end, and fall through. Used by the tests on every puzzle in every level.
//
// Usage: node sequel/tools/solve.mjs [level id]
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { placeEnd } from '../src/wormholes.js';

const DT = 1 / 240;

/**
 * Solve the puzzle `link` (from bp.portalLinks) in `game`. Returns
 * { ok, aim, x } where aim is the angle the far end was opened on.
 */
export function solve(game, link) {
  const bot = game.bot;
  const standX = link.kind === 'bulkhead' ? link.wall - 110 : link.from.x;
  bot.spawn(standX, link.from.y - 31);
  bot.invuln = 1e9;
  for (let i = 0; i < 60; i++) game.step(DT, { mx: 0 });
  const wallX = link.kind === 'bulkhead' ? link.face : link.wall;
  // Sweep the aim from level downward (a bulkhead) or a little either side of level (a chasm).
  const from = link.kind === 'bulkhead' ? 0 : -0.25;
  const to = link.kind === 'bulkhead' ? 0.25 : 0.15;
  let aim = null;
  for (let a = from; a <= to && aim == null; a += 0.002) {
    bot.aim = a;
    const p = placeEnd(game.world, game.sight(), 1);
    if (p && p.nx < -0.9 && Math.abs(p.cx - wallX) < 6) aim = a;
  }
  if (aim == null) return { ok: false, reason: 'no line of sight to the far wall' };
  const press = (a, which) => {
    game.step(DT, { mx: 0, aim: a, worm: [which === 0, which === 1] });
    for (let i = 0; i < 10; i++) game.step(DT, { mx: 0, aim: a });
  };
  press(aim, 1);
  press(Math.PI / 2, 0);
  for (let i = 0; i < 240 * 2; i++) game.step(DT, { mx: 0 });
  const across = link.kind === 'bulkhead' ? bot.x > link.wall + 80 && bot.x < link.face : bot.x > link.to.x - 100 && bot.x < link.wall;
  return { ok: across && bot.onGround, aim, x: bot.x, y: bot.y };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [Number(process.argv[2])] : LEVEL_DEFS.map((l) => l.id);
  for (const id of ids) {
    const bp = level(id);
    for (const link of bp.portalLinks) {
      const game = new Game(bp, { shields: Infinity });
      const r = solve(game, link);
      console.log(`${id} ${link.kind.padEnd(8)} at ${Math.round(link.from.x)}: ${r.ok ? 'solved' : 'NOT SOLVED'} ${r.aim != null ? `aim ${((r.aim * 180) / Math.PI).toFixed(2)} deg` : r.reason || ''} ${r.x != null ? `robot at ${Math.round(r.x)}` : ''}`);
    }
  }
}
