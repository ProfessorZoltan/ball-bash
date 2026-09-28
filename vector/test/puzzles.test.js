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
  // The launch's wedge stands in the middle of the way: its run is down the open lane beside it.
  for (const [type, o, lip, side] of [['chasm', { gap: 12 }, 7, 0], ['launch', { gap: 10 }, 16, 3]]) {
    const { bp, sec } = mini(type, o);
    const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
    const L = Math.hypot(...d);
    const right = [-d[1] / L, d[0] / L];
    const start = standAt(sec.from[0] + right[0] * side, sec.from[1], sec.from[2] + right[1] * side);
    const r = charge(bp, sec, start);
    assert.ok(r.best > lip - 3, `${type}: the run got past the wedge to the lip (${r.best.toFixed(1)})`);
    assert.ok(r.fell || r.best < lip + 0.5, `${type}: the robot got across (${r.best.toFixed(1)})`);
  }
});

test('no end opens across a launch\'s gap from its near side, from anywhere on it, the wedge included; its face and the floor still take one', () => {
  const { bp, sec } = mini('launch', { gap: 10 });
  const g = new Game(bp, { invulnerable: true });
  const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
  const L = Math.hypot(...d);
  const f = [d[0] / L, d[1] / L];
  const right = [-f[1], f[0]];
  const at = (x, y, z) => [sec.from[0] + right[0] * x + f[0] * z, sec.from[1] + y, sec.from[2] + right[1] * x + f[1] * z];
  const lip = 16;
  const across = (p) => (p[0] - sec.from[0]) * f[0] + (p[2] - sec.from[2]) * f[1] > lip + 0.05;
  let tries = 0;
  // Standing all over the near side, and on top of the wedge's high end, aiming at the far floor, walls and pit.
  const stands = [];
  for (const x of [-3, -1.5, 0, 1.5, 3]) for (const z of [1, 4, 12, 14.5, 15.6]) stands.push(at(x, 0.91, z));
  stands.push(at(0, 2.4 + 0.91, 6.3), at(1.5, 2.4 + 0.91, 6.3));
  const targets = [];
  for (const x of [-3.5, -2, 0, 2, 3.5]) for (const z of [lip + 1, lip + 5, lip + 10, lip + 13, lip + 20, lip + 26]) for (const y of [-4, 0, 1, 3]) targets.push(at(x, y, z));
  for (const p of stands) {
    g.bot.spawn(p, 0);
    const eye = g.bot.eyePos();
    for (const q of targets) {
      const dir = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
      const n = Math.hypot(...dir);
      g.bot.yaw = Math.atan2(dir[0], dir[2]);
      g.bot.pitch = Math.asin(dir[1] / n);
      const e = g.openEnd(0);
      tries++;
      assert.ok(!e || !across(e.c), `an end opened across the gap, at ${e && e.c.map((v) => v.toFixed(1))}, from ${p.map((v) => v.toFixed(1))}`);
      g.closeEnd(0, g.me, true);
    }
  }
  assert.ok(tries > 3000);
  // The launch itself: standing at the lip, looking back, an end opens on the wedge's face and one at the robot's feet.
  const link = bp.links.find((k) => k.kind === 'launch');
  g.bot.spawn(at(0, 0.91, lip - 0.9), 0);
  const aim = (p) => {
    const eye = g.bot.eyePos();
    const dir = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    g.bot.yaw = Math.atan2(dir[0], dir[2]);
    g.bot.pitch = Math.asin(dir[1] / Math.hypot(...dir));
  };
  aim(link.face);
  const face = g.openEnd(0);
  aim(link.near);
  const feet = g.openEnd(1);
  assert.ok(face && face.ramp && face.n[1] > 0.5, 'the face takes an end, looking up and out over the gap');
  assert.ok(feet && feet.kind === 'floor', 'and the floor at the lip takes the other');
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
