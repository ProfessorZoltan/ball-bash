// The ten levels: each builds, each is crossed by the autopilot with the
// robot's own physics without losing a shield, and each is a step further
// from the grid than the one before, in its look and in its music.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { BOSSES } from '../src/bosses.js';
import { VECTOR_TRACKS } from '../src/tracks.js';
import { fly } from '../tools/autopilot.mjs';
import { Game } from '../src/game.js';
import { MOVES } from '../src/enemies.js';
import { buildProp } from '../src/props.js';
import { MeshData, solidFaces } from '../src/meshes.js';

test('there are ten levels, each ending in a boss of its own', () => {
  assert.equal(LEVEL_DEFS.length, 10);
  const bosses = new Set(LEVEL_DEFS.map((l) => l.boss));
  assert.equal(bosses.size, 10);
  for (const L of LEVEL_DEFS) assert.ok(BOSSES[L.boss], `${L.title} has a boss`);
  assert.equal(LEVEL_DEFS[9].boss, 'creator', 'the last is the Creator');
});

test('every level is further from the grid than the one before: its look, its music', () => {
  let real = -1;
  let human = -1;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    assert.ok(bp.theme.real > real, `${L.title} is more real than the level before`);
    assert.ok(L.humanity > human, `${L.title} sounds more human than the level before`);
    real = bp.theme.real;
    human = L.humanity;
  }
  assert.equal(level(1).theme.real, 0, 'the first level is the grid');
  assert.equal(level(10).theme.real, 1, 'the last is the world');
});

test('every level has its own track, as human as the level', () => {
  for (const L of LEVEL_DEFS) {
    assert.ok(VECTOR_TRACKS[L.key], `a track for ${L.title}`);
    assert.equal(VECTOR_TRACKS[L.key].humanity, L.humanity, `${L.title}'s music and its sounds agree`);
  }
  for (const k of ['vector', 'creator', 'ending']) assert.ok(VECTOR_TRACKS[k], `a ${k} track`);
});

test('every level builds: a start, an arena, checkpoints, a secret, machines that move in known ways', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    assert.ok(bp.spawn && bp.arena, `${L.title} has a start and an arena`);
    assert.ok(bp.checkpoints.length >= 2, `${L.title} has checkpoints`);
    assert.ok(bp.secrets >= 1, `${L.title} hides a secret`);
    for (const e of bp.enemies) assert.ok(MOVES[e.move], `${L.title}: ${e.look} moves a known way`);
    for (const s of bp.world.solids) for (let i = 0; i < 3; i++) assert.ok(Number.isFinite(s.min[i]) && Number.isFinite(s.max[i]) && s.max[i] > s.min[i], `${L.title}: a solid with a real size`);
  }
});

test('every level from the second holds wormhole puzzles of at least two kinds', () => {
  const kinds = new Set(['bulkhead', 'chasm', 'launch', 'vault', 'orbit']);
  for (const L of LEVEL_DEFS.slice(1)) {
    const bp = level(L.id);
    const have = new Set(bp.sections.map((s) => s.type).filter((t) => kinds.has(t)));
    assert.ok(have.size >= 2, `${L.title} has puzzles of two kinds: ${[...have].join(', ')}`);
    assert.ok(bp.links.length >= 1, `${L.title} records its puzzles`);
  }
});

test('every level is crossed by the autopilot, flying the robot\'s own physics, without losing a shield', () => {
  for (const L of LEVEL_DEFS) {
    const r = fly(L.id);
    assert.ok(r.ok, `${L.title}: ${r.why}`);
  }
});

test('scenery and solids build into meshes with no holes in the numbers', () => {
  for (const L of [LEVEL_DEFS[0], LEVEL_DEFS[5], LEVEL_DEFS[9]]) {
    const bp = level(L.id);
    const m = new MeshData();
    for (const p of bp.props) buildProp(m, p, bp.theme.real);
    for (const s of bp.world.solids) solidFaces(m, s, [1, 1, 1], 0);
    assert.ok(m.count > 1000, `${L.title} has something to draw`);
    assert.ok(m.v.every(Number.isFinite), `${L.title}: every vertex is a number`);
  }
});

test('with its machines awake, every level is still crossed, and every ambush room fought and cleared', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const r = fly(L.id, { enemies: true, invulnerable: true });
    assert.ok(r.ok, `${L.title}: ${r.why}`);
    for (const a of r.game.ambushes) assert.equal(a.state, 'done', `${L.title}: an ambush room left locked`);
    assert.equal(r.game.ambushes.length, bp.ambushes.length);
  }
});

test('a fan catches a robot that walks off its edge anywhere across the pit, and holding forward carries it up onto the ledge', () => {
  let fans = 0;
  for (const L of LEVEL_DEFS) {
    for (const s of level(L.id).sections.filter((x) => x.type === 'fans')) {
      fans++;
      const dir = [s.to[0] - s.from[0], s.to[2] - s.from[2]];
      const d = Math.hypot(...dir);
      const f = [dir[0] / d, dir[1] / d];
      const yaw = Math.atan2(f[0], f[1]);
      const right = [-Math.cos(yaw), Math.sin(yaw)];
      for (const off of [-3.2, -1.6, 0, 1.6, 3.2]) {
        const g = new Game(level(L.id, { noEnemies: true }), { shields: 5, maxShields: 5 });
        g.bot.spawn([s.from[0] + f[0] * 3 + right[0] * off, s.from[1] + 0.91, s.from[2] + f[1] * 3 + right[1] * off], yaw);
        let hurt = null;
        for (let t = 0; t < 6; t += 1 / 120) {
          g.step(1 / 120, { mz: 1 });
          const e = g.events.find((x) => x.s === 'hurt');
          if (e) hurt = e.why;
          g.events.length = 0;
        }
        const b = g.bot;
        const along = (b.pos[0] - s.from[0]) * f[0] + (b.pos[2] - s.from[2]) * f[1];
        assert.equal(hurt, null, `${L.title}: stepping off ${off} m from the middle costs a shield (${hurt})`);
        assert.ok(b.onGround && Math.abs(b.feet - (s.from[1] + s.h)) < 0.1 && along > 10, `${L.title}: stepping off ${off} m from the middle ends on the ledge (at ${b.pos.map((v) => v.toFixed(1))}, ${along.toFixed(1)} m along)`);
      }
    }
  }
  assert.ok(fans >= 2, 'there are fans to try');
});
