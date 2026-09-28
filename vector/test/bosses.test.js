// Every boss can be beaten: the fight tool plays each fight in the real game
// with a robot that cannot be hurt and only fires shots it has flown ahead
// and seen reach a core. The Gantry keeps its heart behind armoured glass,
// so it falls only to a wormhole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS } from '../src/levels.js';
import { BOSSES } from '../src/bosses.js';
import { fight } from '../tools/fight.mjs';
import { level } from '../src/levels.js';
import { Game } from '../src/game.js';
import { makeCharge } from '../src/blaster.js';
import { add } from '../src/math.js';

test('every boss is beaten by a robot that aims well', () => {
  for (const L of LEVEL_DEFS) {
    const r = fight(L.id, { limit: 150 });
    assert.ok(r.ok, `${BOSSES[L.boss].name}: ${r.why}`);
  }
});

test('the Gantry does not fall without wormholes', () => {
  const r = fight(8, { portals: false, limit: 40 });
  assert.ok(!r.ok, 'the Gantry was beaten with no wormhole open');
});

test('the Creator is never the target: the glass round him turns every charge', () => {
  const bp = level(10, { noEnemies: true });
  const g = new Game(bp, { invulnerable: true });
  g.bot.spawn(bp.arena.spawn, bp.arena.yaw);
  g.startBoss();
  g.bossIntro = 0;
  g.step(1 / 120, {});
  const B = g.boss;
  assert.equal(BOSSES.creator.who, 'human');
  const c = makeCharge(add(B.pos, [0, 0, -3]), [0, 0, 1]);
  const hp = B.hp;
  let r = null;
  for (let i = 0; i < 40 && !r; i++) {
    c.pos = add(c.pos, [0, 0, 0.1]);
    r = B.hitBy(c, g);
  }
  assert.equal(r, 'armor', 'the charge met the glass');
  assert.ok(c.vel[2] < 0, 'and was turned back');
  assert.equal(B.hp, hp, 'he took no harm');
});
