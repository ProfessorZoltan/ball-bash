// Solving the puzzles the way a player would, in the real game. Every puzzle
// in a level records itself in bp.portalLinks, and each kind has its answer:
//
//  - bulkhead, chasm: stand at the near side, sweep the aim until the line of
//    sight lands on the far face, open the dark end there, point at the floor
//    underfoot, open the light end, and fall through;
//  - skylight: the same from the cave floor, with the face up through the
//    hole in the roof;
//  - vault: the dark end on the vault's back wall, seen through its glass,
//    the light end on the roof overhead; fire up into it and the charge comes
//    out in the vault, at the switch;
//  - switch, chimney, orbit: find a shot that reaches the switch (flown with
//    the charge's own physics: banks, black holes and all), and fire it; for
//    a timed door, then run for it and be through before it shuts.
//
// Used by the tests on every puzzle in every level.
//
// Usage: node sequel/tools/solve.mjs [level id]
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { placeEnd } from '../src/wormholes.js';
import { Charge, chargeSpec, stepCharge, muzzle } from '../src/blaster.js';
import { BLASTER } from '../src/config.js';

const DT = 1 / 240;
const AIM_DT = 1 / 240; // the game's own step: round a strong black hole, a coarser one would fly a different path

function standAt(game, x, y) {
  const bot = game.bot;
  bot.spawn(x, y - 31);
  bot.invuln = 1e9;
  for (let i = 0; i < 60; i++) game.step(DT, { mx: 0 });
}

/** Sweep the aim from `from` to `to` for an end facing (nx, ny) on the face at x = wall. */
function sweepFor(game, from, to, wall, test) {
  const bot = game.bot;
  const dir = to > from ? 1 : -1;
  for (let a = from; (to - a) * dir >= 0; a += 0.002 * dir) {
    bot.aim = a;
    const p = placeEnd(game.world, game.sight(), 1);
    if (p && test(p) && (wall == null || Math.abs(p.cx - wall) < 6)) return a;
  }
  return null;
}

function press(game, a, which) {
  game.step(DT, { mx: 0, aim: a, worm: [which === 0, which === 1] });
  for (let i = 0; i < 10; i++) game.step(DT, { mx: 0, aim: a });
}

/** Does a standard charge fired from where the robot stands, along `angle`, reach the switch within its life? */
export function shotHits(game, angle, sw) {
  const bot = game.bot;
  const sh = bot.shoulder;
  const spec = chargeSpec('std');
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const at = muzzle(game.world, sh.x, sh.y, dx, dy, spec.r);
  const c = new Charge({ x: at.x, y: at.y, vx: dx * BLASTER.speed, vy: dy * BLASTER.speed, r: spec.r, born: 0, life: spec.life });
  for (let t = 0; t < spec.life; t += AIM_DT) {
    if (!stepCharge(c, game.world, AIM_DT, t, {})) return false;
    if (Math.hypot(c.x - sw.x, c.y - sw.y) < sw.r + c.r - 1) return true;
  }
  return false;
}

/** The switch that opens a link's door. */
function switchOf(game, link) {
  return game.world.switches.find((s) => s.doors.includes(link.door));
}

/**
 * Solve the puzzle `link` (from bp.portalLinks) in `game`. Returns
 * { ok, aim, x } where aim is the angle the telling shot or end took.
 */
export function solve(game, link) {
  const bot = game.bot;
  // A player clears what is shooting at them first; the puzzle is the thing being proved.
  for (const e of game.enemies) if (Math.abs(e.x - link.from.x) < 1600 && Math.abs(e.y - link.from.y) < 1200) e.dead = true;
  if (link.kind === 'bulkhead' || link.kind === 'chasm' || link.kind === 'skylight') {
    const standX = link.kind === 'bulkhead' ? link.wall - 110 : link.kind === 'skylight' ? link.stand : link.from.x;
    standAt(game, standX, link.from.y);
    const wallX = link.kind === 'bulkhead' ? link.face : link.wall;
    // Level and a little down for a bulkhead, either side of level for a chasm, up through the roof for a skylight.
    const [from, to] = link.kind === 'bulkhead' ? [0, 0.25] : link.kind === 'chasm' ? [-0.25, 0.15] : [-Math.PI / 2 + 0.02, -0.05];
    const aim = sweepFor(game, from, to, wallX, (p) => p.nx < -0.9);
    if (aim == null) return { ok: false, reason: 'no line of sight to the far face' };
    press(game, aim, 1);
    press(game, Math.PI / 2, 0);
    for (let i = 0; i < 240 * 2; i++) game.step(DT, { mx: 0 });
    let across;
    if (link.kind === 'bulkhead') across = bot.x > link.wall + 80 && bot.x < link.face;
    else if (link.kind === 'chasm') across = bot.x > link.to.x - 100 && bot.x < link.wall;
    else across = bot.x > link.to.x - 200 && bot.x < link.wall && bot.y < link.from.y - 100;
    return { ok: across && bot.onGround, aim, x: bot.x, y: bot.y };
  }
  const sw = switchOf(game, link);
  if (!sw) return { ok: false, reason: 'no switch for the door' };
  const door = game.world.doors.find((d) => d.id === link.door);
  if (link.kind === 'vault') {
    standAt(game, link.stand, link.from.y);
    const aim = sweepFor(game, -0.3, 0.3, link.wall, (p) => p.nx < -0.9);
    if (aim == null) return { ok: false, reason: 'no line of sight into the vault' };
    press(game, aim, 1);
    press(game, -Math.PI / 2, 0);
    if (!game.world.portals[0][0] || game.world.portals[0][0].ny < 0.9) return { ok: false, reason: 'no end on the roof' };
    game.step(DT, { mx: 0, aim: -Math.PI / 2, fire: true });
    for (let i = 0; i < 240 * 2 && !sw.on; i++) game.step(DT, { mx: 0, aim: -Math.PI / 2 });
    return { ok: sw.on && !door.closed, aim, x: bot.x, y: bot.y };
  }
  // A shot: from each place to stand, the first angle whose charge reaches the switch.
  for (const x of link.stands || [link.from.x]) {
    standAt(game, x, link.from.y);
    if (!bot.onGround) continue;
    const [a0, a1] = link.aim || [-Math.PI, 0];
    for (let a = a0; a <= a1; a += 0.004) {
      if (!shotHits(game, a, sw)) continue;
      game.step(DT, { mx: 0, aim: a, fire: true });
      for (let i = 0; i < 240 * 3.5 && !sw.on; i++) game.step(DT, { mx: 0, aim: a });
      if (sw.on && !door.closed && sw.hold) {
        // A timed door: run for it, and be through before it shuts.
        for (let i = 0; i < 240 * sw.hold && bot.x < door.x + 40; i++) game.step(DT, { mx: 1, run: true });
        return { ok: bot.x >= door.x + 40, aim: a, x, reason: bot.x < door.x + 40 ? 'the door shut before the robot got there' : undefined };
      }
      if (sw.on && !door.closed) return { ok: true, aim: a, x };
      return { ok: false, reason: `the shot at ${((a * 180) / Math.PI).toFixed(1)} deg did not open the door`, x };
    }
  }
  return { ok: false, reason: 'no shot reaches the switch' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [Number(process.argv[2])] : LEVEL_DEFS.map((l) => l.id);
  for (const id of ids) {
    const bp = level(id);
    for (const link of bp.portalLinks) {
      const game = new Game(bp, { shields: Infinity });
      const t0 = performance.now();
      const r = solve(game, link);
      console.log(`${id} ${link.kind.padEnd(8)} at ${Math.round(link.from.x)}: ${r.ok ? 'solved' : 'NOT SOLVED'} ${r.aim != null ? `aim ${((r.aim * 180) / Math.PI).toFixed(2)} deg` : r.reason || ''} ${r.x != null ? `from ${Math.round(r.x)}` : ''} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
}
