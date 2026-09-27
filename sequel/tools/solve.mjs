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
//    a timed door, then run for it and be through before it shuts;
//  - launch: from the pad, the dark end on the ramp's face, the light one
//    underfoot, and the ramp throws the robot across the chasm;
//  - relay: shoot the first switch, and while its door is open put the dark
//    end up through the doorway on the room's roof and the light one
//    underfoot, and drop in; then from the room's floor the same with the
//    second switch and doorway, into the second room.
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

/** The switch that opens a link's door (or its second door). */
function switchOf(game, link, door = link.door) {
  return game.world.switches.find((s) => s.doors.includes(door));
}

/** Fire the first shot from where the robot stands, nearest straight at the switch, that reaches it; and wait for it to go on. */
function shoot(game, sw) {
  const sh = game.bot.shoulder;
  const at = Math.atan2(sw.y - sh.y, sw.x - sh.x);
  for (let k = 0; k < 800; k++) {
    const a = at + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.004;
    if (!shotHits(game, a, sw)) continue;
    game.step(DT, { mx: 0, aim: a, fire: true });
    for (let i = 0; i < 240 * 3.5 && !sw.on; i++) game.step(DT, { mx: 0, aim: a });
    return sw.on ? a : null;
  }
  return null;
}

/** Up through an open doorway: the dark end on the roof beyond, between x0 and x1, the light one underfoot, and through. */
function upThrough(game, x0, x1) {
  const aim = sweepFor(game, -Math.PI / 2 + 0.05, -0.05, null, (p) => p.ny > 0.9 && p.cx - p.hw > x0 && p.cx + p.hw < x1);
  if (aim == null) return null;
  press(game, aim, 1);
  press(game, Math.PI / 2, 0);
  for (let i = 0; i < 240 * 2.5; i++) game.step(DT, { mx: 0 });
  return aim;
}

/** Wait for a timed switch to run down, so it can be shot again. */
function runDown(game, sw) {
  for (let i = 0; i < 240 * 10 && sw.on; i++) game.step(DT, { mx: 0 });
}

function relay(game, link) {
  const bot = game.bot;
  const s1 = switchOf(game, link);
  const s2 = switchOf(game, link, link.door2);
  const [a0, a1, b0, b1] = link.rooms;
  const inRoom = (x0, x1) => bot.onGround && bot.x > x0 && bot.x < x1 && bot.y > link.from.y - 200;
  for (const x of link.stands) {
    standAt(game, x, link.from.y);
    if (shoot(game, s1) == null) continue;
    const aim = upThrough(game, a0, a1);
    if (aim == null || !inRoom(a0, a1)) {
      runDown(game, s1);
      continue;
    }
    // In the first room: the second switch, and the second doorway, from wherever on its floor they both are in sight.
    for (let k = 1; k < (a1 - a0) / 40 - 1; k++) {
      runDown(game, s2);
      standAt(game, a0 + k * 40, link.from.y);
      if (shoot(game, s2) == null) continue;
      if (upThrough(game, b0, b1) != null && inRoom(b0, b1)) return { ok: true, aim, x, y: bot.y };
    }
    return { ok: false, reason: 'no way from the first room through the second doorway', x };
  }
  return { ok: false, reason: 'no way through the first doorway' };
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
    // Where to stand: back from a bulkhead's wall, at a chasm's lip, along a skylight's cave floor to under its hole.
    const stands = link.kind === 'bulkhead' ? [70, 110, 160, 240, 320].map((d) => link.wall - d) : link.kind === 'skylight' ? [0, 2, 4, 6, 8].map((k) => link.stand + k * 40) : [link.from.x, link.from.x - 80];
    const wallX = link.kind === 'bulkhead' ? link.face : link.wall;
    // Level, and a little up or down, for a bulkhead or a chasm; up through the roof for a skylight.
    const [from, to] = link.kind === 'bulkhead' ? [-0.15, 0.5] : link.kind === 'chasm' ? [-0.45, 0.45] : [-Math.PI / 2 + 0.02, -0.05];
    for (const x of stands) {
      standAt(game, x, link.from.y);
      if (!bot.onGround) continue;
      const aim = sweepFor(game, from, to, wallX, (p) => p.nx < -0.9);
      if (aim == null) continue;
      press(game, aim, 1);
      press(game, Math.PI / 2, 0);
      for (let i = 0; i < 240 * 2; i++) game.step(DT, { mx: 0 });
      let across;
      if (link.kind === 'bulkhead') across = bot.x > link.wall + (link.thick || 80) && bot.x < link.face;
      else if (link.kind === 'chasm') across = bot.x > link.to.x - 100 && bot.x < link.wall;
      else across = bot.x > link.to.x - 200 && bot.x < link.wall && bot.y < link.from.y - 100;
      return { ok: across && bot.onGround, aim, x: bot.x, y: bot.y };
    }
    return { ok: false, reason: 'no line of sight to the far face' };
  }
  if (link.kind === 'relay') return relay(game, link);
  if (link.kind === 'launch') {
    standAt(game, link.stand, link.from.y);
    const aim = sweepFor(game, -Math.PI / 2 - 0.05, -Math.PI + 0.05, null, (p) => p.host.seg.kind === 'ramp');
    if (aim == null) return { ok: false, reason: 'the ramp is not in sight from the pad' };
    press(game, aim, 1);
    press(game, Math.PI / 2, 0);
    for (let i = 0; i < 240 * 3 && !(bot.onGround && bot.x > link.far); i++) game.step(DT, { mx: 0 });
    return { ok: bot.onGround && bot.x > link.far && bot.y < link.to.y, aim, x: bot.x, y: bot.y };
  }
  const sw = switchOf(game, link);
  if (!sw) return { ok: false, reason: 'no switch for the door' };
  const door = game.world.doors.find((d) => d.id === link.door);
  if (link.kind === 'vault') {
    standAt(game, link.stand, link.from.y);
    // The dark end inside: on the back wall, or on the ramp at its foot.
    const aim = link.ramp ? sweepFor(game, -0.3, 0.6, null, (p) => p.host.seg.kind === 'ramp') : sweepFor(game, -0.3, 0.3, link.wall, (p) => p.nx < -0.9);
    if (aim == null) return { ok: false, reason: 'no line of sight into the vault' };
    press(game, aim, 1);
    // The light end where a charge can go into it (the roof, a lintel behind, the floor), and a shot straight into it.
    const tries = { roof: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3], behind: [-Math.PI + 0.05, -Math.PI / 2 - 0.05], floor: [Math.PI / 2 + 0.35, Math.PI / 2 + 1.3] }[link.via || 'roof'];
    for (let a = tries[0]; a <= tries[1]; a += 0.01) {
      bot.aim = a;
      const p = placeEnd(game.world, game.sight(), 0);
      if (!p || p.host.seg.kind === 'ramp' || (link.via === 'floor' && Math.abs(p.cx - bot.x) < 70)) continue;
      press(game, a, 0);
      if (!shotHits(game, a, sw)) continue;
      game.step(DT, { mx: 0, aim: a, fire: true });
      for (let i = 0; i < 240 * 2 && !sw.on; i++) game.step(DT, { mx: 0, aim: a });
      return { ok: sw.on && !door.closed, aim, x: bot.x, y: bot.y };
    }
    return { ok: false, reason: `no shot into an end ${link.via || 'on the roof'} comes out at the switch` };
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
