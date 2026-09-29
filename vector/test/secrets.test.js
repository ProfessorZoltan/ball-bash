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
import { STORY } from '../src/story.js';
import { stepRobot, standAt } from '../src/player.js';
import { POWER, PHYSICS_DT } from '../src/config.js';

test('every level hides five secrets or more, of three kinds or more, one of them a hideaway, and each new one has its way written down', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    assert.ok(bp.secrets >= 5, `${L.title}: ${bp.secrets} secrets`);
    assert.ok(bp.detours.length >= 4, `${L.title}: ways to its secrets`);
    assert.equal(bp.sections.filter((s) => s.type === 'hideaway').length, 1, `${L.title}: one hideaway`);
    const kinds = new Set(bp.sections.map((s) => s.type).filter((t) => ['secret', 'loft', 'crawl', 'cache', 'lookback', 'glitch', 'targets', 'rooftop', 'hideaway'].includes(t)));
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
      if (r.kind === 'hideaway') assert.ok([...r.game.said].some((l) => l.text === STORY.hideaways[L.id - 1].text), `${L.title}: the record is read out in the hideaway`);
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

test('a hideaway\'s gallery is too high for any jump, from anywhere in the room below it', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id, { noEnemies: true });
    const sec = bp.sections.find((s) => s.type === 'hideaway');
    if (sec.puzzle !== 'ledge') continue;
    const cov = bp.world.solids.find((s) => s.id === sec.cover);
    bp.world.remove(cov);
    const dir = [sec.to[0] - sec.from[0], 0, sec.to[2] - sec.from[2]];
    const n = Math.hypot(dir[0], dir[2]);
    const f = [dir[0] / n, 0, dir[2] / n];
    const out = [-f[2] * sec.side, 0, f[0] * sec.side]; // toward the rooms
    const g = new Game(bp, { invulnerable: true, noWaves: true });
    const w = bp.def.width / 2;
    for (const z of [3, 7, 11]) {
      for (const x of [w + 1.5, w + 4, w + 6.5]) {
        // Stood in the first room, facing the gallery, running and jumping at it.
        const at = [sec.from[0] + f[0] * z + out[0] * x, sec.from[1], sec.from[2] + f[2] * z + out[2] * x];
        g.bot.spawn(standAt(...at), Math.atan2(out[0], out[2]));
        let top = -Infinity;
        for (let t = 0; t < 4; t += PHYSICS_DT) {
          stepRobot(g.bot, { mz: 1, run: true, jump: true, jumpPress: g.bot.onGround }, g.world, PHYSICS_DT, []);
          if (g.bot.onGround) top = Math.max(top, g.bot.feet);
        }
        assert.ok(top > sec.from[1] - 0.1, `${L.title}: stood in the first room`);
        assert.ok(top < sec.from[1] + 3, `${L.title}: stood at ${top.toFixed(2)}, the gallery is at ${(sec.from[1] + 3.4).toFixed(2)}`);
      }
    }
  }
});

test('a shield cell raises the most a robot holds by one, and fills it; a stash fills a power-up to the top', () => {
  const g = new Game(level(3), { shields: 3, maxShields: 5, noWaves: true });
  const pl = g.me;
  g.take({ kind: 'cell', pos: [0, 0, 0], id: 'c' }, pl);
  assert.equal(pl.maxShields, 6);
  assert.equal(pl.shields, 4);
  g.take({ kind: 'power', power: 'big', stash: true, pos: [0, 0, 0], id: 's' }, pl);
  assert.equal(pl.ammo.big, POWER.maxAmmo);
  g.take({ kind: 'power', power: 'triple', pos: [0, 0, 0], id: 't' }, pl);
  assert.equal(pl.ammo.triple, POWER.ammo, 'an ordinary one gives its usual');
});
