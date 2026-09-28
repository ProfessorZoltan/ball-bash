// Co-op: two or three robots through a campaign level, each on its own
// shields. A hit costs only the robot that took it; one with none left is out
// until a teammate reaches a checkpoint or the boss; the level is lost only
// with the whole team out. The team goes into an ambush room and the boss's
// arena together, enemies go after whoever is nearest, every robot has its
// own pair of wormhole ends that anyone can go through, a teammate's charge
// goes straight through you, and what drops, drops for each of you.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { makeCharge } from '../src/blaster.js';
import { Enemy } from '../src/enemies.js';
import { COOP, PHYSICS_DT, ROBOT, PLAYERS } from '../src/config.js';

const DT = PHYSICS_DT;
const team = (id, n = 2, o = {}) => new Game(level(id, { noEnemies: true }), { mode: 'coop', players: n, shields: 3, maxShields: 3, ...o });
const centre = (b) => [(b.min[0] + b.max[0]) / 2, b.min[1] + 1, (b.min[2] + b.max[2]) / 2];

/** An enemy's shot at a robot, from a metre away. */
function shotAt(g, pl) {
  const at = [pl.bot.pos[0], pl.bot.pos[1] + 0.3, pl.bot.pos[2] - 1];
  g.shots.push(makeCharge(at, [0, 0, 1], 'std', 'enemy', { speed: 13, r: 0.25 }));
}

test('the team starts side by side, each robot on its own shields, and a hit costs only the robot that took it', () => {
  const g = team(1, 3);
  const [a, b, c] = g.players;
  assert.ok(Math.hypot(a.bot.pos[0] - b.bot.pos[0], a.bot.pos[2] - b.bot.pos[2]) > COOP.spread * 0.9, 'side by side, not on top of each other');
  assert.ok(new Set(g.players.map((p) => p.bot.pos.map((v) => v.toFixed(2)).join())).size === 3);
  shotAt(g, b);
  for (let i = 0; i < 30 && b.shields === 3; i++) g.step(DT, []);
  assert.deepEqual(g.players.map((p) => p.shields), [3, 2, 3]);
  assert.ok(b.bot.invuln > 0 && a.bot.invuln <= 0, 'only the one hit flickers');
});

test('a robot with no shields is out, its ends shut; a teammate at a checkpoint brings it back with one shield', () => {
  const g = team(2, 2, { shields: 1, maxShields: 3 });
  const [a, b] = g.players;
  a.bot.yaw = Math.PI / 2;
  g.openEnd(0, a);
  shotAt(g, a);
  for (let i = 0; i < 30 && !a.out; i++) g.step(DT, []);
  assert.ok(a.out, 'out');
  assert.equal(g.state, 'play', 'and the level goes on');
  assert.ok(!a.ends[0] && !a.ends[1], 'its ends shut');
  const cp = g.bp.checkpoints[0];
  b.bot.spawn(cp.p, cp.yaw);
  g.step(DT, []);
  assert.ok(!a.out, 'back in');
  assert.equal(a.shields, COOP.revive);
  assert.ok(Math.hypot(a.bot.pos[0] - cp.p[0], a.bot.pos[2] - cp.p[2]) < COOP.spread + 0.1, 'beside the checkpoint');
  assert.equal(g.checkpoint, 0);
});

test('the level is lost only when the whole team is out', () => {
  const g = team(1, 2, { shields: 1, maxShields: 1 });
  const [a, b] = g.players;
  shotAt(g, a);
  for (let i = 0; i < 30 && !a.out; i++) g.step(DT, []);
  assert.equal(g.state, 'play');
  shotAt(g, b);
  for (let i = 0; i < 30 && !b.out; i++) g.step(DT, []);
  assert.equal(g.state, 'down');
});

test('the boss fight starts when anyone walks in: the rest of the team is brought in, anyone out comes back, the door shuts', () => {
  const g = team(3, 3, { shields: 1, maxShields: 3 });
  const [a, b, c] = g.players;
  shotAt(g, c);
  for (let i = 0; i < 30 && !c.out; i++) g.step(DT, []);
  assert.ok(c.out);
  const A = g.bp.arena;
  a.bot.spawn(centre(A.trigger), A.yaw);
  g.step(DT, []);
  assert.equal(g.phase, 'boss');
  assert.ok(!c.out, 'the robot that was out is back');
  for (const pl of g.players) {
    const p = pl.bot.pos;
    assert.ok(p[0] >= A.min[0] - 0.5 && p[0] <= A.max[0] + 0.5 && p[2] >= A.min[2] - 0.5 && p[2] <= A.max[2] + 0.5, `${pl.name} is in the arena`);
  }
  assert.equal(A.door.door.open, false, 'the door shuts behind the team');
});

test('an ambush room locks with the whole team inside', () => {
  const L = LEVEL_DEFS.find((d) => level(d.id).ambushes.length);
  const g = new Game(level(L.id), { mode: 'coop', players: 2, shields: 3, maxShields: 3, noWaves: true });
  const room = g.ambushes[0];
  const [a, b] = g.players;
  a.bot.spawn(centre(room), 0);
  g.step(DT, []);
  assert.notEqual(room.state, 'wait');
  const p = b.bot.pos;
  assert.ok(p[0] >= room.min[0] && p[0] <= room.max[0] && p[2] >= room.min[2] && p[2] <= room.max[2], 'the teammate outside was brought in');
});

test('an enemy goes after the robot nearest it', () => {
  const g = team(1, 2);
  const [a, b] = g.players;
  b.bot.spawn([a.bot.pos[0], a.bot.pos[1], a.bot.pos[2] + 30], 0);
  const e = new Enemy({ move: 'chaser', look: 'cubelet', p: [b.bot.pos[0] + 6, b.bot.pos[1], b.bot.pos[2]] });
  g.addEnemy(e);
  const d0 = Math.hypot(e.pos[0] - b.bot.pos[0], e.pos[2] - b.bot.pos[2]);
  for (let t = 0; t < 0.8; t += DT) g.step(DT, []);
  assert.ok(e.awake, 'woken by the robot nearest it');
  assert.ok(Math.hypot(e.pos[0] - b.bot.pos[0], e.pos[2] - b.bot.pos[2]) < d0 - 1, 'and after it');
});

test('every robot has its own pair of ends, in its own colours, and anyone can go through anyone\'s', () => {
  const g = team(1, 2);
  const [a, b] = g.players;
  // The first robot opens a pair ahead of it on the floor, a way apart.
  a.bot.pitch = -0.35;
  const e0 = g.openEnd(0, a);
  a.bot.pitch = -0.18;
  const e1 = g.openEnd(1, a);
  assert.ok(e0 && e1, 'a pair opens');
  assert.equal(e0.color, PLAYERS[0].ends[0]);
  assert.ok(!b.ends[0] && !b.ends[1], 'the other robot has none of its own yet');
  b.bot.pitch = -0.25;
  assert.ok(g.openEnd(0, b), 'and opens its own');
  assert.equal(b.ends[0].color, PLAYERS[1].ends[0]);
  assert.ok(a.ends[0] === e0, 'without touching the first robot\'s');
  g.closeEnd(0, b, true);
  // The second robot drops through the first robot's floor end.
  b.bot.spawn([e0.c[0], e0.c[1] + 2.5, e0.c[2]], 0);
  let warped = false;
  for (let t = 0; t < 2 && !warped; t += DT) {
    g.step(DT, []);
    warped = g.events.some((e) => e.s === 'warp' && e.slot === 1);
    g.events.length = 0;
  }
  assert.ok(warped, 'through the other robot\'s end');
});

test('a teammate\'s charge goes straight through you', () => {
  const g = team(1, 2);
  const [a, b] = g.players;
  const at = [b.bot.pos[0], b.bot.pos[1] + 0.3, b.bot.pos[2] - 1];
  g.charges.push(makeCharge(at, [0, 0, 1], 'std', 0));
  for (let i = 0; i < 30; i++) g.step(DT, []);
  assert.equal(b.shields, 3);
  assert.ok(g.charges.length === 1, 'and flies on');
});

test('what drops, drops once for each robot still in, and only that robot takes it', () => {
  const g = team(1, 2);
  const [a, b] = g.players;
  const p = [a.bot.pos[0], a.bot.pos[1], a.bot.pos[2] + 4];
  const before = g.pickups.length;
  g.dropAt(p, 'big');
  const drops = g.pickups.slice(before);
  assert.deepEqual(drops.map((d) => d.owner), [0, 1]);
  // The first robot walks over both.
  for (const d of drops) {
    a.bot.spawn([d.pos[0], a.bot.pos[1], d.pos[2]], 0);
    for (let i = 0; i < 60; i++) g.step(DT, []);
  }
  assert.ok(drops[0].taken && !drops[1].taken, 'it takes its own and leaves its teammate\'s');
  assert.equal(a.ammo.big > 0, true);
  assert.equal(b.ammo.big, 0);
});

test('alone, it is the campaign as it was: one robot, and out of shields is the level lost', () => {
  const g = new Game(level(1, { noEnemies: true }), { shields: 1, maxShields: 1 });
  assert.equal(g.players.length, 1);
  shotAt(g, g.me);
  for (let i = 0; i < 30 && g.state === 'play'; i++) g.step(DT, {});
  assert.equal(g.state, 'down');
  assert.ok(ROBOT.invuln > 0);
});
