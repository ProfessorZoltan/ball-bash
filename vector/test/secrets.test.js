// The secrets: every level hides four or more, of more than one kind, and
// the later levels hide some that look exactly like what they are set in.
// Each has its way written down, and the autopilot flies it with the
// robot's own physics to the prize with no shield lost; the level's own way
// through takes none of them (levels.test.js). A hidden panel knocks hollow;
// three targets open their wall only all together; a wall the grid never
// finished stops nothing, and shows itself every few seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { Game } from '../src/game.js';
import { flyDetour } from '../tools/secrets.mjs';

test('every level hides four secrets or more, of three kinds or more, and each new one has its way written down', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    assert.ok(bp.secrets >= 4, `${L.title}: ${bp.secrets} secrets`);
    assert.ok(bp.detours.length >= 3, `${L.title}: ways to its secrets`);
    const kinds = new Set(bp.sections.map((s) => s.type).filter((t) => ['secret', 'loft', 'crawl', 'cache', 'lookback', 'glitch', 'targets', 'rooftop'].includes(t)));
    assert.ok(kinds.size >= 3, `${L.title}: ${[...kinds].join(', ')}`);
  }
});

test('from the fourth level on, some secrets wear the look of the wall, floor or beam they are set in', () => {
  for (const L of LEVEL_DEFS.slice(3)) {
    const hidden = level(L.id).world.solids.filter((s) => s.cover && s.secret && s.role !== 'cover');
    assert.ok(hidden.length >= 1, `${L.title} hides a panel in plain sight`);
    for (const s of hidden) assert.ok(['wall', 'floor', 'roof', 'trim'].includes(s.role) && !s.mat, `${L.title}: a ${s.role} like any other`);
  }
});

test('every secret\'s way is flown with the robot\'s own physics, to its prize, no shield lost', () => {
  for (const L of LEVEL_DEFS) {
    const n = level(L.id, { noEnemies: true }).detours.length;
    for (let k = 0; k < n; k++) {
      const r = flyDetour(L.id, k);
      assert.ok(r.ok, `${L.title}, ${r.kind}: ${r.why}`);
    }
  }
});

test('a secret\'s panel knocks hollow when a shot does not break it; a crate only thunks', () => {
  const bp = level(4);
  const g = new Game(bp, { noWaves: true });
  const panel = bp.world.solids.find((s) => s.cover && s.secret && s.role === 'wall');
  const crate = { crate: true, hp: 5, min: [0, 0, 0], max: [1, 1, 1] };
  g.events.length = 0;
  g.damageBlock(panel, { damage: 1, kind: 'std', pos: [0, 0, 0] });
  assert.ok(g.events.some((e) => e.s === 'hollow') && !g.events.some((e) => e.s === 'thunk'));
  g.events.length = 0;
  g.damageBlock(crate, { damage: 1, kind: 'std', pos: [0, 0, 0] });
  assert.ok(g.events.some((e) => e.s === 'thunk') && !g.events.some((e) => e.s === 'hollow'));
  // The second shot breaks a hidden panel, and says so.
  g.events.length = 0;
  g.damageBlock(panel, { damage: 1, kind: 'std', pos: [0, 0, 0] });
  assert.ok(panel.gone && g.events.some((e) => e.s === 'secretOpen'));
});

test('three targets open their wall only when all three are hit', () => {
  for (const id of [2, 4, 6, 8, 9, 10]) {
    const bp = level(id);
    const g = new Game(bp, { noWaves: true });
    const sec = bp.sections.find((s) => s.type === 'targets');
    const door = bp.world.solids.find((s) => s.door && s.door.id === sec.door);
    const sws = sec.targets.map((t) => bp.world.switches.find((x) => x.id === t));
    // The robot beside them, so the switches take the shots.
    g.bot.spawn(sec.from, 0);
    for (const order of [[0, 1], [1, 2], [2, 0]]) {
      for (const sw of sws) sw.on = false;
      door.door.open = false;
      for (const k of order) g.flip(sws[k]);
      assert.equal(door.door.open, false, `level ${id}: two of three leave it shut`);
    }
    g.events.length = 0;
    for (const sw of sws) g.flip(sw);
    assert.equal(door.door.open, true, `level ${id}: all three open it`);
    assert.ok(g.events.some((e) => e.s === 'secretOpen'));
  }
});

test('a wall the grid never finished stops nothing and shows itself every few seconds, in the grid\'s levels only', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const ghosts = bp.world.solids.filter((s) => s.glitch);
    if (!ghosts.length) continue;
    assert.ok(bp.theme.real < 0.3, `${L.title}: glitches belong to the grid`);
    for (const s of ghosts) {
      const c = [(s.min[0] + s.max[0]) / 2, s.min[1] + 1, (s.min[2] + s.max[2]) / 2];
      assert.ok(bp.world.capsuleFree(c, 0.5, 0.4), `${L.title}: a robot walks through it`);
      const hit = bp.world.raycast([c[0], c[1], c[2] - 0.001], [1, 0, 0], 0.4);
      assert.ok(!hit || hit.solid !== s, `${L.title}: no shot or sight line stops on it`);
      let shown = 0;
      let steps = 0;
      for (let t = 0; t < 20; t += 1 / 60, steps++) {
        bp.world.step(1 / 60);
        if (s.warn) shown++;
      }
      assert.ok(shown > 0 && shown < steps * 0.2, `${L.title}: it shows now and then (${shown} of ${steps})`);
    }
  }
});
