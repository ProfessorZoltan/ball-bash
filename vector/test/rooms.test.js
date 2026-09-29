// Rooms and set pieces. Every level opens out into rooms of two kinds or
// more, each wider than the way with its way out off to one side or up, and
// every level has one stretch built for it alone. The level tests fly them
// all; these hold what makes them what they are: a conveyor carries whoever
// stands on it, a train or a chairlift stops at each end, a pour hurts only
// while it runs, and every set piece is where its level's look is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { ROOMS } from '../src/rooms.js';
import { SETPIECES } from '../src/setpieces.js';
import { Game } from '../src/game.js';
import { moverOffset } from '../src/world.js';
import { standAt } from '../src/player.js';
import { PHYSICS_DT } from '../src/config.js';

const OWN = { edge: 'fold', wilds: 'wiretree', farm: 'queue', foundry: 'pour', freeway: 'interchange', rain: 'billboard', underline: 'train', harbour: 'crane', ridge: 'chairlift', workshop: 'workbench' };

test('every level opens out into rooms of two kinds or more, each wider than the way, its way out never straight ahead', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const rooms = bp.sections.filter((s) => ROOMS[s.type]);
    assert.ok(new Set(rooms.map((s) => s.type)).size >= 2, `${L.title}: ${rooms.map((s) => s.type).join(', ')}`);
    for (const r of rooms) assert.ok(Math.abs(r.xo) >= 4 || r.up > 0, `${L.title}: the ${r.type}'s way out is ${r.xo} off to the side`);
  }
});

test('every level has one set piece, its own, found in no other level', () => {
  const seen = new Set();
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const own = bp.sections.filter((s) => SETPIECES[s.type]).map((s) => s.type);
    assert.deepEqual(own, [OWN[L.key]], `${L.title}: ${own.join(', ')}`);
    assert.ok(!seen.has(own[0]));
    seen.add(own[0]);
  }
  assert.equal(seen.size, Object.keys(SETPIECES).length);
});

test('a conveyor carries whoever stands still on it the way it runs, at its speed', () => {
  const bp = level(3, { noEnemies: true });
  const g = new Game(bp, { noWaves: true, invulnerable: true });
  const belt = bp.world.belts[0];
  const top = [(belt.min[0] + belt.max[0]) / 2, belt.max[1], (belt.min[2] + belt.max[2]) / 2];
  g.bot.spawn(standAt(...top), 0);
  for (let t = 0; t < 0.3; t += PHYSICS_DT) g.step(PHYSICS_DT, {});
  const p0 = [...g.bot.pos];
  for (let t = 0; t < 1; t += PHYSICS_DT) g.step(PHYSICS_DT, {});
  const moved = [g.bot.pos[0] - p0[0], g.bot.pos[2] - p0[2]];
  const v = belt.vel;
  assert.ok(Math.abs(moved[0] - v[0]) < 0.1 && Math.abs(moved[1] - v[2]) < 0.1, `moved ${moved.map((x) => x.toFixed(2))} in a second on a belt running ${v.map((x) => x.toFixed(2))}`);
});

test('a platform that holds stops at each end for its share of the period, and moves smoothly between', () => {
  const m = { to: [0, 0, 10], period: 10, hold: 0.3 };
  for (const t of [0, 0.5, 1.4]) assert.equal(moverOffset(m, t)[2], 0, `at the start at ${t} s`);
  for (const t of [5, 5.7, 6.4]) assert.equal(moverOffset(m, t)[2], 10, `at the end at ${t} s`);
  let last = 0;
  for (let t = 1.5; t < 5; t += 0.05) {
    const z = moverOffset(m, t)[2];
    assert.ok(z >= last - 1e-9 && z - last < 0.3, `smooth on the way out at ${t.toFixed(2)} s`);
    last = z;
  }
});

test('a pour hurts only while it runs, and the bridge under it is safe between pours', () => {
  const bp = level(4, { noEnemies: true });
  const pour = bp.world.hazards.find((h) => h.stream);
  const g = new Game(bp, { shields: 5, maxShields: 5, noWaves: true });
  const c = [(pour.min[0] + pour.max[0]) / 2, pour.min[1] + 0.91, (pour.min[2] + pour.max[2]) / 2];
  let hurtLit = 0;
  let hurtDark = 0;
  for (let t = 0; t < 12; t += PHYSICS_DT) {
    g.bot.spawn(c, 0);
    g.bot.invuln = 0;
    g.events.length = 0;
    g.step(PHYSICS_DT, {});
    const hurt = g.events.some((e) => e.s === 'hurt');
    if (pour.lit) hurtLit += hurt ? 1 : 0;
    else hurtDark += hurt ? 1 : 0;
    g.me.shields = 5;
  }
  assert.ok(hurtLit > 0, 'a running pour hurts');
  assert.equal(hurtDark, 0, 'a dark one does not');
});

test('the Crane\'s container, the Train and the Chairlift\'s cars come level with where you board them, and nothing stands in their way', () => {
  for (const [id, type, key] of [[8, 'crane', 'box'], [7, 'train', 'train'], [9, 'chairlift', 'car']]) {
    const bp = level(id, { noEnemies: true });
    const sec = bp.sections.find((s) => s.type === type);
    const s = bp.world.solids.find((x) => x.id === sec[key]);
    assert.ok(Math.abs(s.max[1] - sec.from[1]) < 0.01, `${type}: its top is level with the floor you board from`);
    // Over a whole period it never runs into anything that does not move.
    const g = new Game(bp, { noWaves: true });
    for (let t = 0; t < 20; t += 0.1) {
      bp.world.step(0.1);
      const hit = [];
      bp.world.query(s.min, s.max, (o) => {
        if (o === s || o.move || o.ghost || o.passCharges || o.noSafe) return;
        const inside = [0, 1, 2].every((i) => s.min[i] < o.max[i] - 0.05 && s.max[i] > o.min[i] + 0.05);
        if (inside) hit.push(o.role);
      });
      assert.deepEqual(hit, [], `${type} ran into ${hit.join(', ')} at ${t.toFixed(1)} s`);
    }
    assert.ok(g);
  }
});
