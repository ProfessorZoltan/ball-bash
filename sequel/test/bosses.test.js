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
  assert.ok(shielded.length >= 5 && shielded.length < 10, `${shielded.length} of ten carry shields`);
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
