// A puzzle is only a puzzle if the obvious way fails. Each kind is built on
// its own and tried the wrong way: walked at, jumped at full run, shot at
// from everywhere with no wormhole open, or with its black hole taken away.
// The autopilot (levels.test.js) proves the right way works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Builder } from '../src/build.js';
import { SECTIONS } from '../src/sections.js';
import { Game } from '../src/game.js';
import { stepRobot, standAt } from '../src/player.js';
import { guideLine } from '../src/blaster.js';
import { lookDir } from '../src/math.js';
import { PHYSICS_DT } from '../src/config.js';
import { fly } from '../tools/autopilot.mjs';

const DT = PHYSICS_DT;

function mini(type, o = {}, def = {}) {
  const b = new Builder({ seed: 7, width: 8, roster: [], ...def });
  SECTIONS.start(b, {});
  const at = b.route.length;
  SECTIONS[type](b, o);
  SECTIONS.run(b, { foes: 0 });
  const bp = b.finish();
  bp.spawn = b.spawn;
  bp.theme = { real: 0, sky: ['#000', '#000', '#000'], roles: {} };
  bp.arena = null;
  bp.def = { key: 'test' };
  return { bp, sec: bp.sections[1], at };
}

/** How far along the section's way a robot got (its own frame's z). */
function along(sec, p) {
  const d = [p[0] - sec.from[0], p[2] - sec.from[2]];
  const L = Math.hypot(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]);
  return (d[0] * (sec.to[0] - sec.from[0]) + d[1] * (sec.to[2] - sec.from[2])) / L;
}

/** Run at the obstacle along the way, jumping at the edge, and see how far the robot gets. */
function charge(bp, sec, from, seconds = 6) {
  const g = new Game(bp, { invulnerable: true });
  g.bot.spawn(from, Math.atan2(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]));
  let best = -Infinity;
  let fell = false;
  for (let t = 0; t < seconds; t += DT) {
    const ev = stepRobot(g.bot, { mz: 1, run: true, jump: true, jumpPress: g.bot.onGround }, g.world, DT, []);
    if (ev.some((e) => e.s === 'fall')) {
      fell = true;
      break;
    }
    if (g.bot.onGround) best = Math.max(best, along(sec, g.bot.pos));
  }
  return { best, fell };
}

test('a bulkhead cannot be walked or jumped under: its slot is lower than the robot', () => {
  const { bp, sec } = mini('bulkhead', { gapH: 1.3, thick: 2 });
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best < 9.5, `got to ${r.best.toFixed(1)} m, past the wall's face at 9`);
});

test('a chasm and a launch cannot be jumped, even at a full run from the lip', () => {
  for (const [type, o, lip] of [['chasm', { gap: 12 }, 7], ['launch', { gap: 10 }, 12]]) {
    const { bp, sec } = mini(type, o);
    const start = standAt(...[sec.from[0], sec.from[1], sec.from[2]]);
    const r = charge(bp, sec, start);
    assert.ok(r.fell || r.best < lip + 0.5, `${type}: the robot got across (${r.best.toFixed(1)})`);
  }
});

test('with the wormholes, each puzzle is crossed', () => {
  for (const type of ['bulkhead', 'chasm', 'launch', 'vault', 'orbit']) {
    const { bp } = mini(type);
    const g = new Game(bp, { shields: Infinity, maxShields: Infinity, noWaves: true });
    const r = flyGame(g);
    assert.ok(r.ok, `${type}: ${r.why}`);
  }
});

function flyGame(g) {
  // The autopilot's own loop, on a hand-built blueprint.
  return fly(null, { game: g });
}

/** Fire from many places along the way, in every direction, with no wormhole open: does any shot flip the switch? */
function anyShot(bp, sec, n = 900) {
  const g = new Game(bp, { invulnerable: true });
  const sw = bp.world.switches[0];
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const k = (i % 9) / 8;
    const p = [sec.from[0] + (sec.to[0] - sec.from[0]) * k * 0.7, sec.from[1] + 0.9, sec.from[2] + (sec.to[2] - sec.from[2]) * k * 0.7];
    g.bot.spawn(p, 0);
    const yaw = ((i * 137.5) % 360) * (Math.PI / 180);
    const pitch = (((i * 61) % 170) - 85) * (Math.PI / 180);
    const dir = lookDir(yaw, pitch);
    const gl = guideLine(g.world, [], g.muzzle(dir), dir, 'std', 3);
    if (gl.end && gl.end.solid && gl.end.solid.switchRef === sw) hits++;
  }
  return hits;
}

test('a vault\'s switch is sealed: no shot from the way reaches it without a wormhole', () => {
  const { bp, sec } = mini('vault');
  assert.equal(anyShot(bp, sec), 0);
});

test('an orbit\'s switch is out of every straight line: without its black hole, no shot reaches it', () => {
  const { bp, sec } = mini('orbit');
  bp.world.wells.length = 0;
  assert.equal(anyShot(bp, sec), 0);
});

test('a door stays shut until its switch is shot', () => {
  const { bp, sec } = mini('switchdoor');
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best < 10.5, `walked through a shut door (${r.best.toFixed(1)})`);
});

test('the same full-run charge does clear an ordinary running gap, so the tests above are not vacuous', () => {
  const { bp, sec } = mini('gap', { gap: 5.5, run: true });
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best > 14, `fell short of an ordinary gap (${r.best.toFixed(1)})`);
});
