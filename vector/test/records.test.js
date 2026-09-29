// What finding secrets comes to: a record of each level's, kept by keys that
// are the same every time the level is built; every secret in a level
// unlocks a finish for the blaster, and every secret in all ten opens Echo,
// the bonus level, which the autopilot crosses and whose boss can be beaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level, levelDef, secretsIn, ECHO } from '../src/levels.js';
import { foundIn, withFound, levelComplete, everySecret, finishesOpen, FINISHES } from '../src/records.js';
import { flyDetour } from '../tools/secrets.mjs';
import { fly } from '../tools/autopilot.mjs';
import { fight } from '../tools/fight.mjs';

test('a level\'s count of secrets is known without building it', () => {
  for (const L of LEVEL_DEFS) assert.equal(secretsIn(L), level(L.id).secrets, L.title);
  assert.equal(secretsIn(ECHO), 0, 'Echo hides none: it is the prize');
});

test('a secret is known by the same key every time its level is built, and each counts once', () => {
  for (const id of [1, 5, 9]) {
    const n = level(id, { noEnemies: true }).detours.length;
    for (let k = 0; k < n; k++) {
      const a = [...flyDetour(id, k).game.found];
      const b = [...flyDetour(id, k).game.found];
      assert.equal(a.length, 1);
      assert.deepEqual(a, b, `level ${id}, secret ${k}`);
    }
  }
  let rec = withFound({}, 3, 'p4');
  rec = withFound(rec, 3, 'p4');
  assert.equal(foundIn(rec, 3).size, 1);
});

test('every secret in a level unlocks its finish for the blaster; every secret in all ten opens Echo', () => {
  let rec = {};
  assert.deepEqual(finishesOpen(rec), ['standard']);
  assert.ok(!everySecret(rec));
  for (const L of LEVEL_DEFS) {
    for (let i = 0; i < secretsIn(L) - 1; i++) rec = withFound(rec, L.id, `k${i}`);
    assert.ok(!levelComplete(rec, L), `${L.title}: one short`);
    rec = withFound(rec, L.id, 'last');
    assert.ok(levelComplete(rec, L), `${L.title}: all found`);
    assert.ok(finishesOpen(rec).includes(L.key));
    assert.ok(FINISHES[L.key], `${L.title} has a finish`);
    assert.equal(everySecret(rec), L === LEVEL_DEFS[LEVEL_DEFS.length - 1], 'Echo waits for the last level\'s last secret');
  }
  assert.equal(finishesOpen(rec).length, LEVEL_DEFS.length + 1);
});

test('Echo is its own level, outside the campaign, crossed by the autopilot, and its boss can be beaten', () => {
  assert.equal(levelDef(ECHO.id), ECHO);
  assert.ok(!LEVEL_DEFS.includes(ECHO), 'not part of the run');
  const r = fly(ECHO.id);
  assert.ok(r.ok, `Echo: ${r.why}`);
  const f = fight(ECHO.id, { limit: 180 });
  assert.ok(f.ok, `The Echo: ${f.why}`);
});
