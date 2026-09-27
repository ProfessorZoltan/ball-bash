// Defector's troves: in three of the later levels, a pit that looks like any
// other is a shaft to a floor, with a cracked wall at its foot hiding a
// shield and a power-up of every kind, and a drain at the back that takes a
// shield and puts you back up top. A wormhole end left at the rim is the
// other way out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS, TROVE_LEVELS } from '../src/levels.js';
import { Charge } from '../src/blaster.js';
import { BLASTER, POWERUPS, TILE } from '../src/config.js';

const DT = 1 / 240;
const T = TILE;
const run = (g, s, it = { mx: 0 }) => {
  for (let i = 0; i < 240 * s; i++) g.step(DT, it);
};
const alone = (bp) => {
  const g = new Game(bp, { shields: 5 });
  for (const e of g.enemies) e.dead = true;
  return g;
};

test('three of the fourth to the tenth levels have a trove, chosen once and the same every time', () => {
  assert.equal(TROVE_LEVELS.length, 3);
  for (const id of TROVE_LEVELS) assert.ok(id >= 4 && id <= 10);
  for (const L of LEVEL_DEFS) {
    const n = (level(L.id).troves || []).length;
    assert.equal(n, TROVE_LEVELS.includes(L.id) ? 1 : 0, `${L.title}`);
  }
});

test('from above a trove is a pit like the others: a jump across, the far rim level with the near', () => {
  for (const id of TROVE_LEVELS) {
    const t = level(id).troves[0];
    assert.ok(t.rimR - t.rimL <= 4 * T, 'no wider than a walking jump');
    assert.ok(t.footY - t.floorY >= 16 * T, `and deep: ${Math.round((t.footY - t.floorY) / T)} tiles, past where any other pit takes you`);
  }
});

test('falling in costs nothing; the wall at the foot breaks under fire; behind it, a shield and every power-up; the drain puts you back up top for a shield', () => {
  for (const id of TROVE_LEVELS) {
    const bp = level(id);
    const t = bp.troves[0];
    const g = alone(bp);
    const bot = g.bot;
    bot.spawn(t.rimL - 3 * T, t.floorY - 31);
    run(g, 0.5);
    const safe = { ...bot.safe };
    // Walk off the rim.
    for (let i = 0; i < 240 * 4 && !(bot.onGround && bot.y > t.footY - 2 * T); i++) g.step(DT, { mx: 1 });
    assert.equal(g.pool, 5, `level ${id}: the fall cost nothing`);
    assert.ok(bot.onGround && Math.abs(bot.bottom - t.footY) < 2, `level ${id}: it lands on the shaft's floor`);
    // Shoot the wall from where it landed.
    const cover = g.world.crates[t.cover];
    run(g, 0.2);
    for (let k = 0; k < 6 && !cover.broken; k++) {
      g.charges.push(new Charge({ x: t.rimL + T + 20, y: t.footY - 40, vx: BLASTER.speed, vy: 0, born: g.time, owner: 0 }));
      run(g, 0.25);
    }
    assert.ok(cover.broken, `level ${id}: the cracked wall breaks`);
    const loot = g.pickups.filter((p) => p.x > t.rimR && p.x < t.drain[0] && Math.abs(p.y - t.footY) < T).map((p) => p.kind);
    assert.ok(loot.includes('shield'), 'a shield');
    for (const pu of POWERUPS) assert.ok(loot.includes(pu.id), `and a ${pu.name}`);
    bot.invuln = 0;
    // Walk in with a shield down, take it all, and on into the drain at the back.
    g.pool = 4;
    for (let i = 0; i < 240 * 6 && bot.y > t.floorY; i++) g.step(DT, { mx: 1 });
    const taken = loot.length - g.pickups.filter((p) => p.x > t.rimR && p.x < t.drain[0]).length;
    assert.equal(taken, loot.length, `level ${id}: all of it taken`);
    assert.ok(g.secrets.some((s) => s.found && s.x0 > t.rimR - T && s.x1 < t.drain[1] + T), 'and it counts as a secret');
    assert.equal(g.pool, 4, `level ${id}: the drain costs a shield, the one in the trove`);
    assert.ok(bot.y < t.floorY && Math.abs(bot.x - safe.x) < 3 * T, `level ${id}: back up top, near where it went in (at ${Math.round(bot.x)},${Math.round(bot.y)})`);
  }
});

test('a wormhole end left at the rim is the way back up', () => {
  for (const id of TROVE_LEVELS) {
    const bp = level(id);
    const t = bp.troves[0];
    const g = alone(bp);
    const bot = g.bot;
    bot.spawn(t.rimL - 4 * T, t.floorY - 31);
    run(g, 0.5);
    // One end in the floor a little back from the rim, then off the edge.
    bot.aim = Math.PI / 2 + 0.25;
    assert.ok(g.deploy(0), 'an end at the rim');
    bot.spawn(t.rimL - T, t.floorY - 31);
    for (let i = 0; i < 240 * 4 && !(bot.onGround && bot.y > t.footY - 2 * T); i++) g.step(DT, { mx: 1 });
    assert.ok(bot.y > t.footY - 2 * T, 'down at the foot');
    // The other at its feet, and step in.
    run(g, 0.3);
    bot.aim = Math.PI / 2;
    assert.ok(g.deploy(1), 'an end at the foot');
    // Out of the rim end, steer back from the edge rather than drop in again.
    let up = false;
    for (let i = 0; i < 240 * 3 && !up; i++) {
      g.step(DT, { mx: bot.y < t.floorY ? -1 : 0 });
      up = bot.onGround && bot.y < t.floorY;
    }
    assert.ok(up, `level ${id}: back up at the rim`);
    assert.equal(g.pool, 5, 'for nothing');
  }
});

test('nothing at a trove\'s foot is where a fall puts you back', () => {
  const id = TROVE_LEVELS[0];
  const bp = level(id);
  const t = bp.troves[0];
  const g = alone(bp);
  const bot = g.bot;
  bot.spawn(t.rimL - 3 * T, t.floorY - 31);
  run(g, 0.5);
  for (let i = 0; i < 240 * 4 && !(bot.onGround && bot.y > t.footY - 2 * T); i++) g.step(DT, { mx: 1 });
  run(g, 2);
  assert.ok(bot.onGround && bot.y > t.footY - 2 * T, 'standing at the foot');
  assert.ok(bot.safe.y < t.floorY, 'the safe spot is still up top');
});
