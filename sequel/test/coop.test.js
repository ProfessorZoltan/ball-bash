// Defector co-op: up to three robots on the same level, each with a shield
// pool of their own. One who runs out is out, until a teammate reaches a
// checkpoint or the boss; the level is lost only when the whole team is out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { level } from '../src/levels.js';
import { buildLevel } from '../src/build.js';
import { Charge } from '../src/blaster.js';
import { Enemy } from '../src/enemies.js';
import { BLASTER, COOP, ROBOT } from '../src/config.js';
import { placeEnd, sightLine } from '../src/wormholes.js';

const DT = 1 / 240;
const flat = (len = 60) => buildLevel({ id: 70, boss: 'gardener', theme: {}, sections: [['flat', { len, deco: false }]] });
const team = (bp, n = 3, o = {}) => new Game(bp, { mode: 'coop', players: n, shields: 3, ...o });
const run = (g, s, its = []) => {
  for (let i = 0; i < 240 * s; i++) g.step(DT, its);
};

test('a team starts side by side on the spawn, each on its own pool', () => {
  const g = team(level(1));
  assert.equal(g.players.length, 3);
  run(g, 0.5);
  for (const p of g.players) {
    assert.ok(p.bot.onGround, `${p.name} is standing`);
    assert.equal(p.pool, 3);
  }
  const xs = g.players.map((p) => p.bot.x);
  assert.equal(new Set(xs).size, 3, 'not on top of each other');
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 2 * COOP.spread + 1);
});

test('a hit costs only the robot that took it', () => {
  const g = team(flat());
  run(g, 1.1);
  g.hurt('enemy', { x: 0, y: 0 }, false, g.players[1]);
  assert.deepEqual(g.players.map((p) => p.pool), [3, 2, 3]);
});

test('a player out of shields is out, the rest play on, and the level is lost only when all are out', () => {
  const g = team(flat());
  run(g, 1.1);
  const [a, b, c] = g.players;
  for (let k = 0; k < 3; k++) {
    b.bot.invuln = 0;
    g.hurt('enemy', null, false, b);
  }
  assert.ok(b.out, 'the second robot is out');
  assert.equal(g.phase, 'play', 'and the level goes on');
  assert.ok(g.events.some((e) => e.s === 'out' && e.slot === 1));
  const bx = b.bot.x;
  run(g, 0.5, [{ mx: 1 }, { mx: 1 }, { mx: 1 }]);
  assert.equal(b.bot.x, bx, 'one who is out does not move');
  assert.ok(a.bot.x > bx, 'the others do');
  for (const p of [a, c]) {
    for (let k = 0; k < 3; k++) {
      p.bot.invuln = 0;
      g.hurt('enemy', null, false, p);
    }
  }
  assert.equal(g.phase, 'down', 'with the whole team out, the level is lost');
});

test('reaching a checkpoint brings back everyone who was out, there, with one shield', () => {
  const bp = level(1);
  const g = team(bp);
  run(g, 0.5);
  const [a, b, c] = g.players;
  for (const p of [b, c]) {
    for (let k = 0; k < 3; k++) {
      p.bot.invuln = 0;
      g.hurt('enemy', null, false, p);
    }
  }
  assert.ok(b.out && c.out);
  const cp = bp.checkpoints[0];
  a.bot.spawn(cp.x - 200, cp.y);
  for (const e of g.enemies) e.dead = true;
  for (let i = 0; i < 240 * 3 && b.out; i++) g.step(DT, [{ mx: 1 }]);
  assert.ok(!b.out && !c.out, 'both came back');
  for (const p of [b, c]) {
    assert.equal(p.pool, COOP.revive, `${p.name} with ${COOP.revive} shield`);
    assert.ok(Math.abs(p.bot.x - cp.x) < 2 * COOP.spread + 1, `${p.name} at the checkpoint`);
  }
  assert.ok(g.events.some((e) => e.s === 'revive'));
});

test('the boss fight brings the whole team into the arena, and anyone out comes back there', () => {
  const bp = level(1);
  const g = team(bp);
  run(g, 0.5);
  const [a, b, c] = g.players;
  for (let k = 0; k < 3; k++) {
    c.bot.invuln = 0;
    g.hurt('enemy', null, false, c);
  }
  assert.ok(c.out);
  const A = bp.arena;
  b.bot.spawn(A.x0 - 3000, A.floor - 31); // lagging far behind
  a.bot.spawn(A.x0 + 200, A.floor - 31);
  for (const e of g.enemies) e.dead = true;
  g.step(DT, []);
  assert.equal(g.phase, 'intro');
  assert.ok(!c.out && c.pool === COOP.revive, 'the one who was out is back');
  for (const p of g.players) assert.ok(p.bot.x > A.x0 + 20 && p.bot.x < A.x1, `${p.name} is inside the arena`);
  run(g, 1);
  for (const p of g.players) assert.ok(p.bot.onGround && p.bot.y < A.floor, `${p.name} is on the arena floor`);
});

test('an enemy goes after the robot nearest it', () => {
  const g = team(flat(80), 2);
  const [a, b] = g.players;
  a.bot.spawn(300, -31);
  b.bot.spawn(2600, -31);
  // Facing left, toward the far robot; the near one is just behind it.
  const e = new Enemy({ kind: 'dasher', x: 2450, y: -18, dir: -1 }, 99);
  g.enemies.push(e);
  e.awake = true;
  run(g, 0.5, [{ mx: 0 }, { mx: 0 }]);
  assert.ok(e.x > 2450 && e.state === 'charge', `it turns on the robot at 2600, not the one at 300 (${Math.round(e.x)})`);
});

test('a teammate\'s charge goes straight through you', () => {
  const g = team(flat(), 2);
  run(g, 1.1);
  const [a, b] = g.players;
  b.bot.spawn(1000, -31);
  run(g, 0.2);
  g.charges.push(new Charge({ x: 900, y: b.bot.y, vx: BLASTER.speed, vy: 0, born: g.time, owner: 0 }));
  run(g, 0.4);
  assert.equal(b.pool, 3, 'no shield lost');
});

test('six charges in the air is each player\'s own limit', () => {
  const g = team(flat(), 2);
  run(g, 1.1);
  const [a, b] = g.players;
  for (let k = 0; k < 6; k++) {
    a.cool = 0;
    assert.ok(g.fire(a), `the first player's charge ${k + 1}`);
  }
  a.cool = 0;
  assert.ok(!g.fire(a), 'a seventh is refused');
  assert.ok(g.fire(b), 'while the second player can still fire');
  assert.equal(g.chargesOf(a), 6);
  assert.equal(g.chargesOf(b), 1);
});

test('each player has a wormhole pair of their own, and anyone can go through anyone\'s', () => {
  const bp = flat(80);
  bp.solids.push({ pts: [[1400, -600], [1440, -600], [1440, 0], [1400, 0]] });
  const g = team(bp, 2);
  run(g, 1.1);
  const [a, b] = g.players;
  a.bot.spawn(600, -31);
  b.bot.spawn(1200, -31);
  run(g, 0.3);
  // The second player opens a pair: one end in the floor at their feet, the other on the far side of the wall.
  b.bot.aim = Math.PI / 2;
  assert.ok(g.deploy(0, b));
  const w = g.world;
  w.portals[1][1] = placeEnd(w, sightLine(w, 2000, -200, Math.PI / 2), 1, 1);
  assert.ok(w.portals[1][1], 'the far end opens in the floor past the wall');
  assert.equal(w.portals[0][0], null, 'the first player\'s pair is untouched');
  assert.equal(w.portals[1][0].owner, 1);
  // The first player walks over to the second player's floor end and drops through.
  a.bot.spawn(b.bot.x, -31);
  b.bot.spawn(900, -31);
  let through = false;
  for (let i = 0; i < 240 * 2 && !through; i++) {
    g.step(DT, [{ mx: 0 }, { mx: 0 }]);
    through = a.bot.x > 1500;
  }
  assert.ok(through, 'the first player came out of the second player\'s far end');
});

test('a boss watches the nearest robot, and looks again every few seconds', () => {
  const bp = level(1);
  const g = team(bp, 2);
  run(g, 0.3);
  const [a, b] = g.players;
  const A = bp.arena;
  for (const e of g.enemies) e.dead = true;
  a.bot.spawn(A.x0 + 200, A.floor - 31);
  b.bot.spawn(A.x0 + 250, A.floor - 31);
  g.step(DT, []);
  run(g, 3);
  const boss = g.boss;
  b.bot.spawn(boss.x + 40, A.floor - 31);
  a.bot.spawn(A.x0 + 150, A.floor - 31);
  g.bossEyeUntil = 0;
  assert.equal(g.bossTarget(), b.bot, 'the nearer robot');
  a.bot.spawn(boss.x, A.floor - 31);
  b.bot.spawn(A.x1 - 100, A.floor - 31);
  assert.equal(g.bossTarget(), b.bot, 'it keeps its eye on one for a while');
  g.time += COOP.retarget + 0.1;
  assert.equal(g.bossTarget(), a.bot, 'then looks again');
});

test('a player alone plays exactly the campaign: one robot, the level lost with the last shield', () => {
  const g = new Game(flat(), { shields: 1 });
  assert.equal(g.players.length, 1);
  assert.equal(g.mode, 'solo');
  run(g, 1.1);
  g.hurt('enemy', null);
  assert.equal(g.phase, 'down');
  assert.equal(g.bot.slot, 0);
  assert.equal(ROBOT.r, g.bot.r);
});
