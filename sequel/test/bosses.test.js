// Defector: the ten bosses. Each is its own fight, each can be beaten (by a
// robot that aims well: sequel/tools/fight.mjs), and the ones that only a
// wormhole beats cannot be beaten any other way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSSES, BOSS_ORDER } from '../src/bosses.js';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { Game } from '../src/game.js';
import { Charge } from '../src/blaster.js';
import { BLASTER } from '../src/config.js';
import { DefectorAudio } from '../src/audio.js';
import { fight } from '../tools/fight.mjs';

const DT = 1 / 240;

test('ten bosses, one at the end of each level, each with its own brain, arena and toughness', () => {
  assert.equal(BOSS_ORDER.length, 10);
  assert.deepEqual(LEVEL_DEFS.map((l) => l.boss), BOSS_ORDER);
  const brains = new Set(BOSS_ORDER.map((id) => BOSSES[id].update));
  assert.equal(brains.size, 10, 'no two share a brain');
  const hps = new Set(BOSS_ORDER.map((id) => BOSSES[id].hp));
  assert.equal(hps.size, 10, 'no two take the same number of hits');
  for (const id of BOSS_ORDER) assert.ok(BOSSES[id].arena && BOSSES[id].name && BOSSES[id].epithet, id);
});

test('some bosses carry shields: Deflector plates that turn a charge away', () => {
  const g = new Game(level(4), { shields: Infinity });
  const A = g.arena;
  g.bot.spawn(A.x0 + 160, A.floor - 31);
  for (let i = 0; i < 240 * 3; i++) g.step(DT, { mx: 0 });
  const plates = g.boss.parts.filter((p) => p.type === 'plate');
  assert.ok(plates.length >= 2, 'the Keeper turns its plates round its lamp');
  const shielded = BOSS_ORDER.filter((id) => {
    const bp = level(LEVEL_DEFS.find((l) => l.boss === id).id);
    const gg = new Game(bp, { shields: Infinity });
    gg.bot.spawn(bp.arena.x0 + 160, bp.arena.floor - 31);
    for (let i = 0; i < 240 * 3; i++) gg.step(DT, { mx: 0 });
    return gg.boss.parts.some((p) => p.type === 'plate');
  });
  assert.ok(shielded.length >= 5, `${shielded.length} of ten carry shields`);
});

test('the Gardener\'s grass-box turns a charge away from its front, and its back is open', () => {
  const g = new Game(level(1), { shields: Infinity });
  const A = g.arena;
  g.bot.spawn(A.x0 + 160, A.floor - 31);
  for (let i = 0; i < 240 * 4 && g.phase !== 'boss'; i++) {
    g.bot.invuln = 1e9;
    g.step(DT, { mx: 0 });
  }
  const b = g.boss;
  for (let i = 0; i < 240 && Math.abs(b.guard + Math.PI) > 0.01; i++) g.step(DT, { mx: 0 });
  assert.ok(b.dir < 0 && Math.abs(b.guard + Math.PI) < 0.01, 'driving left, the box on its left');
  const hp = b.hp;
  const front = new Charge({ x: b.x - 200, y: b.y, vx: BLASTER.speed, vy: 0, born: g.time });
  g.charges.push(front);
  for (let i = 0; i < 120; i++) g.step(DT, { mx: 0 });
  assert.equal(b.hp, hp, 'a charge at its front is turned away');
  const back = new Charge({ x: b.x + 150, y: b.y, vx: -BLASTER.speed, vy: 0, born: g.time });
  g.charges.push(back);
  for (let i = 0; i < 120 && b.hp === hp; i++) g.step(DT, { mx: 0 });
  assert.equal(b.hp, hp - 1, 'a charge at its back lands');
});

for (const L of LEVEL_DEFS) {
  test(`${BOSSES[L.boss].name} can be beaten`, () => {
    const r = fight(L.id);
    assert.ok(r.beaten, `still at ${r.hp} after ${r.seconds} s`);
  });
}

test('the Conductor can only be beaten through a wormhole in the roof', () => {
  const r = fight(3, { portals: false, limit: 90 });
  assert.ok(!r.beaten && r.hits === 0, 'no shot from the floor, however banked, reached its core');
});

test('the Cartographer is folded: a charge that has not been through a wormhole passes through it', () => {
  const g = new Game(level(9), { shields: Infinity });
  const A = g.arena;
  g.bot.spawn(A.x0 + 160, A.floor - 31);
  for (let i = 0; i < 240 * 3; i++) g.step(DT, { mx: 0 });
  const b = g.boss;
  const hp = b.hp;
  const plain = new Charge({ x: b.x - 60, y: b.y, vx: BLASTER.speed, vy: 0, born: g.time });
  assert.equal(g.chargeVsBoss(Object.assign(plain, { x: b.x, y: b.y })), false);
  assert.equal(b.hp, hp);
  const warped = new Charge({ x: b.x, y: b.y, vx: BLASTER.speed, vy: 0, born: g.time });
  warped.warps = 1;
  assert.equal(g.chargeVsBoss(warped), true);
  assert.equal(b.hp, hp - 1);
});

test('the Astronomer charts black holes as it fights: never on the robot, a warning first, and gone when it falls', () => {
  const g = new Game(level(6), { shields: Infinity });
  const A = g.arena;
  g.bot.spawn(A.x0 + 160, A.floor - 31);
  const seen = new Map();
  let most = 0;
  for (let i = 0; i < 240 * 30; i++) {
    g.bot.invuln = 1e9;
    g.step(DT, { mx: Math.sin(i / 240) > 0 ? 1 : -1 });
    const charted = g.world.wells.filter((w) => w.charted);
    most = Math.max(most, charted.length);
    for (const w of charted) {
      if (!seen.has(w)) {
        assert.ok(w.absent, 'a new hole is only a ring closing in at first: it does not pull yet');
        assert.ok(Math.hypot(w.x - g.bot.x, w.y - g.bot.y) >= 260, 'and it is never charted on top of the robot');
        assert.ok(w.x > A.x0 && w.x < A.x1 && w.y > A.top && w.y < A.floor, 'it is inside the arena');
        seen.set(w, g.time);
      } else if (g.time - seen.get(w) > 1.5 && g.time - seen.get(w) < 9) assert.ok(!w.absent, 'then it opens, and pulls');
    }
  }
  assert.ok(seen.size >= 4, `${seen.size} holes charted in 30 s`);
  assert.ok(most <= 3, 'never more than three at once');
  g.phase = 'boss';
  g.damageBoss({ freeze: false, damage: 999 }, { cx: g.boss.x, cy: g.boss.y, nx: 1, ny: 0 });
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0 });
  assert.equal(g.world.wells.filter((w) => w.charted).length, 0, 'what it charted goes with it');
});

test('the Astronomer turns its lens to meet a charge coming straight at it, and looks away when it charts a hole', () => {
  let shots = 0;
  let hits = 0;
  let glanced = false;
  for (const spot of [200, 450, 830, 1080]) {
    const g = new Game(level(6), { shields: Infinity });
    const A = g.arena;
    g.bot.spawn(A.x0 + 160, A.floor - 31);
    for (let i = 0; i < 240 * 4 && g.phase !== 'boss'; i++) {
      g.bot.invuln = 1e9;
      g.step(DT, { mx: 0 });
    }
    g.bot.spawn(A.x0 + spot, A.floor - 31);
    for (let i = 0; i < 240 * 12 && g.phase === 'boss'; i++) {
      g.bot.invuln = 1e9;
      const b = g.boss;
      const s = g.bot.shoulder;
      const hp = b.hp;
      const fire = i % 120 === 0;
      g.step(DT, { mx: 0, aim: Math.atan2(b.y - s.y, b.x - s.x), fire });
      if (fire) shots++;
      if (g.boss.hp < hp) hits++;
      if (b.glance > 0.5 && Math.abs(Math.atan2(Math.sin(b.guard - b.glanceAt), Math.cos(b.guard - b.glanceAt))) < 0.2) glanced = true;
    }
  }
  assert.ok(hits < shots * 0.2, `aimed straight at its core, ${hits} of ${shots} got past the lens`);
  assert.ok(glanced, 'it turned its lens to look at a hole it charted');
});

test('the music doubles for the boss, and settles back after', () => {
  const a = new DefectorAudio();
  a.bossTime(true);
  assert.equal(a.tempoTarget, 2);
  a.bossTime(false);
  assert.equal(a.tempoTarget, 1);
  const g = new Game(level(1), { shields: Infinity });
  g.bot.spawn(g.arena.x0 + 160, g.arena.floor - 31);
  g.step(DT, { mx: 0 });
  assert.ok(g.events.some((e) => e.s === 'bossIntro'), 'the game says when the fight starts');
});

test('a continue after losing to a boss starts again at the boss\'s door', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const g = new Game(bp, { shields: 1 });
    g.bot.spawn(bp.arena.x0 + 160, bp.arena.floor - 31);
    g.step(DT, { mx: 0 });
    assert.ok(g.checkpoints[g.checkpoint].boss, `${L.title}: reaching the boss is a checkpoint`);
    g.bot.invuln = 0;
    g.hurt('enemy', { x: g.bot.x, y: g.bot.y });
    assert.equal(g.phase, 'down');
    const again = new Game(bp, { shields: 5, checkpoint: g.checkpoint, stats: { ...g.stats, continues: 1 } });
    assert.ok(again.bot.x > bp.arena.x0 && again.bot.x < bp.arena.x0 + 200, `${L.title}: back at the door`);
    again.step(DT, { mx: 0 });
    assert.equal(again.phase, 'intro', `${L.title}: and straight into the fight`);
  }
});

test('after each boss the exit opens where the robot can walk to it from the door', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const g = new Game(bp, { shields: Infinity });
    const A = g.arena;
    g.bot.spawn(A.x0 + 160, A.floor - 31);
    g.step(DT, { mx: 0 });
    g.phase = 'boss';
    g.damageBoss({ freeze: false, damage: 999 }, { cx: g.boss.x, cy: g.boss.y, nx: 1, ny: 0 });
    for (let i = 0; i < 240 * 3; i++) {
      g.bot.invuln = 1e9;
      g.step(DT, { mx: 0 });
    }
    assert.equal(g.phase, 'exit', `${L.title}: the exit opened`);
    // Walk to it, jumping whenever a step makes no headway, as a player would.
    g.bot.spawn(A.x0 + 120, A.floor - 31);
    let lastX = g.bot.x;
    let stuck = 0;
    for (let i = 0; i < 240 * 12 && g.phase !== 'cleared'; i++) {
      g.bot.invuln = 1e9;
      const mx = Math.sign(g.exit.x - g.bot.x);
      stuck = Math.abs(g.bot.x - lastX) < 0.3 ? stuck + 1 : 0;
      lastX = g.bot.x;
      const jump = stuck > 10 || (!g.bot.onGround && g.bot.vy < 0);
      g.step(DT, { mx, jump, jumpPressed: stuck === 11 });
    }
    assert.equal(g.phase, 'cleared', `${L.title}: the exit at ${Math.round(g.exit.x - A.x0)} could not be reached`);
  }
});
