// Defector's lairs: in three levels, a cracked panel in the foot of a step is
// the way into a cave under the path, more than three times the size of an
// ambush room, full of enemies that stir only once the panel breaks. Clear it
// and a shield and a handful of power-ups drop. Nothing on the way on needs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS, LAIR_LEVELS, TROVE_LEVELS } from '../src/levels.js';
import { Charge } from '../src/blaster.js';
import { BLASTER, POWERUPS, TILE } from '../src/config.js';
import { reachability } from '../tools/reach.mjs';

const DT = 1 / 240;
const T = TILE;
const run = (g, s, it = { mx: 0 }) => {
  for (let i = 0; i < 240 * s; i++) g.step(DT, it);
};
const ofLair = (g, i) => g.enemies.filter((e) => e.lair === i);
const shootCover = (g, l) => {
  const cover = g.world.crates[l.cover];
  for (let k = 0; k < 8 && !cover.broken; k++) {
    g.charges.push(new Charge({ x: l.mouth.x - T, y: l.mouth.y - 40, vx: BLASTER.speed, vy: 0, born: g.time, owner: 0 }));
    run(g, 0.25);
  }
  return cover.broken;
};

test('three levels from the third to the tenth have a lair, none of them one with a trove', () => {
  assert.equal(LAIR_LEVELS.length, 3);
  for (const id of LAIR_LEVELS) {
    assert.ok(id >= 3 && id <= 10);
    assert.ok(!TROVE_LEVELS.includes(id), `level ${id} has a trove already`);
  }
  for (const L of LEVEL_DEFS) assert.equal((level(L.id).lairs || []).length, LAIR_LEVELS.includes(L.id) ? 1 : 0, L.title);
});

test('a lair is more than three times the size of the biggest ambush room, and holds more than one of its waves', () => {
  let room = 0;
  let wave = 0;
  for (const L of LEVEL_DEFS) {
    for (const a of level(L.id).ambushes) {
      room = Math.max(room, (a.x1 - a.x0) * (a.floor - a.top));
      wave = Math.max(wave, ...a.waves.map((w) => w.length));
    }
  }
  for (const id of LAIR_LEVELS) {
    const bp = level(id);
    const l = bp.lairs[0];
    const size = (l.x1 - l.x0) * (l.floor - l.top);
    assert.ok(size >= 3 * room, `level ${id}: ${(size / room).toFixed(1)} times an ambush room`);
    assert.ok(bp.enemies.filter((e) => e.lair === 0).length > wave, `level ${id}: more enemies than a wave`);
    assert.ok(l.reward.includes('shield') && l.reward.filter((k) => POWERUPS.some((p) => p.id === k)).length >= 3, 'a shield and several power-ups');
  }
});

test('nothing in a lair stirs, or is drawn, until its cover breaks', () => {
  for (const id of LAIR_LEVELS) {
    const bp = level(id);
    const l = bp.lairs[0];
    const g = new Game(bp, { shields: 5 });
    const bot = g.bot;
    // On the path over it, and at its mouth.
    for (const [x, y] of [[(l.x0 + l.x1) / 2, l.top - 2 * T - 31], [l.mouth.x - T, l.mouth.y - 31]]) {
      bot.spawn(x, y);
      bot.invuln = 1e9;
      const was = ofLair(g, 0).map((e) => [e.x, e.y]);
      run(g, 2);
      for (const [k, e] of ofLair(g, 0).entries()) {
        assert.ok(!e.awake && g.sealed(e), `level ${id}: a ${e.kind} sleeps`);
        assert.deepEqual([e.x, e.y], was[k], 'and has not moved');
      }
    }
  }
});

test('once its cover breaks a lair wakes; when the last of it falls, a shield and power-ups drop, and it counted as a secret', () => {
  for (const id of LAIR_LEVELS) {
    const bp = level(id);
    const l = bp.lairs[0];
    const g = new Game(bp, { shields: 5 });
    const bot = g.bot;
    bot.spawn(l.mouth.x - 3 * T, l.mouth.y - 31);
    bot.invuln = 1e9;
    run(g, 0.3);
    assert.ok(shootCover(g, l), `level ${id}: the panel breaks`);
    assert.ok(ofLair(g, 0).every((e) => !g.sealed(e)));
    // In, and down to its floor.
    bot.spawn((l.x0 + l.x1) / 2, l.floor - 31);
    bot.invuln = 1e9;
    run(g, 1);
    assert.ok(ofLair(g, 0).some((e) => e.awake), 'it stirs');
    assert.ok(g.secrets.some((s) => s.found && s.x0 === l.x0 && s.x1 === l.x1), 'a secret found');
    const loot = () => g.pickups.filter((p) => p.x > l.x0 && p.x < l.x1 && p.y > l.top && p.y < l.floor + 10);
    const before = loot().length;
    const foes = ofLair(g, 0).filter((e) => !e.dead);
    for (const e of foes.slice(0, -1)) g.defeat(e);
    run(g, 0.5);
    assert.ok(!g.lairs[0].cleared, 'not while one is left');
    bot.spawn(l.x0 + 2 * T, l.floor - 31); // out of the way of the drop, to count it
    bot.invuln = 1e9;
    g.defeat(foes[foes.length - 1]);
    run(g, 2);
    assert.ok(g.lairs[0].cleared, `level ${id}: cleared`);
    const got = loot().slice(before).map((p) => p.kind);
    for (const k of l.reward) assert.ok(got.includes(k), `a ${k} dropped in the cave (${got.join(', ')})`);
  }
});

test('from a lair\'s floor the robot climbs back up to the tunnel and out, and the way on never needs it', () => {
  for (const id of LAIR_LEVELS) {
    const bp = level(id);
    const l = bp.lairs[0];
    const out = reachability(bp, { from: { x: (l.x0 + l.x1) / 2, y: l.floor - 31 }, targets: [{ x: l.mouth.x - 2 * T, y: l.mouth.y - 31 }] });
    assert.ok(out.ok, `level ${id}: out of the lair`);
    // With its cover left standing, the path on past it is still reached from before it.
    const c = bp.crates[l.cover];
    const shut = { ...bp, solids: [...bp.solids, { pts: [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]], kind: 'block' }] };
    const over = reachability(shut, { from: { x: l.mouth.x - 2 * T, y: l.mouth.y - 31 }, targets: [{ x: l.x1 + 4 * T, y: l.mouth.y - 31 }] });
    assert.ok(over.ok, `level ${id}: over it`);
  }
});
