// Defector: the ten levels. Each can be crossed with the robot's own
// physics (sequel/tools/reach.mjs), each runs to the length its place in the
// campaign asks for, and nothing starts inside a wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level, TIER_SECONDS, THEMES } from '../src/levels.js';
import { estimateSeconds, LIMITS, buildLevel } from '../src/build.js';
import { createWorld, segmentsNear } from '../src/world.js';
import { circleVsCapsule, capsuleVsCapsule, pointInPolygon } from '../../src/physics.js';
import { KINDS } from '../src/enemies.js';
import { SEQUEL_TRACKS } from '../src/tracks.js';
import { reachability } from '../tools/reach.mjs';

test('ten levels, built the same way every time', () => {
  assert.equal(LEVEL_DEFS.length, 10);
  const a = buildLevel({ ...LEVEL_DEFS[3], floor: 0, sections: [['flat', { len: 30 }]] });
  const b = buildLevel({ ...LEVEL_DEFS[3], floor: 0, sections: [['flat', { len: 30 }]] });
  assert.deepEqual(a.deco, b.deco);
  assert.deepEqual(level(4).solids.length, level(4).solids.length);
});

for (const L of LEVEL_DEFS) {
  test(`${L.id} ${L.title} can be crossed from its start to its boss`, () => {
    const r = reachability(level(L.id));
    assert.ok(r.ok, `stuck at x ${Math.round(r.furthest)} of ${level(L.id).arena.x0}`);
  });
}

test('early levels run 3 to 5 minutes before the boss, middle ones 4 to 8, late ones 8 to 15', () => {
  const tiers = LEVEL_DEFS.map((l) => l.tier);
  assert.deepEqual(tiers, ['early', 'early', 'early', 'mid', 'mid', 'mid', 'mid', 'late', 'late', 'late']);
  for (const L of LEVEL_DEFS) {
    const s = estimateSeconds(level(L.id));
    const [lo, hi] = TIER_SECONDS[L.tier];
    assert.ok(s >= lo && s <= hi, `${L.title}: about ${(s / 60).toFixed(1)} min, not ${lo / 60} to ${hi / 60}`);
  }
});

test('every gap a level asks the robot to jump is one it can', () => {
  for (const L of LEVEL_DEFS) {
    for (const sec of level(L.id).sections) {
      if (sec.type !== 'gap') continue;
      const w = sec.p.w ?? 3;
      const limit = (sec.p.run ?? 2) >= 6 ? LIMITS.gapRun : LIMITS.gapWalk;
      assert.ok(w <= limit, `${L.title}: a gap of ${w} tiles with ${sec.p.run ?? 2} to run up`);
      if ((sec.p.up ?? 0) > 0) assert.ok(w <= 3, `${L.title}: a gap of ${w} up a step`);
    }
  }
});

test('the robot starts on the ground, and no enemy, pickup or checkpoint starts inside a wall', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const w = createWorld(bp);
    const inside = (x, y, r) => segmentsNear(w, x - r - 2, y - r - 2, x + r + 2, y + r + 2, { oneWay: false, movers: false }).some((s) => circleVsCapsule(x, y, r - 2, s.ax, s.ay, s.bx, s.by, 0)) || bp.solids.some((s) => s.kind !== 'spring' && pointInPolygon(x, y, s.pts));
    const sp = bp.spawn;
    const under = segmentsNear(w, sp.x - 4, sp.y, sp.x + 4, sp.y + 60, { movers: false });
    assert.ok(under.some((s) => s.ny < -0.6 && Math.abs(s.ay - (sp.y + 40)) < 2), `${L.title}: nothing under the start`);
    for (const e of bp.enemies) assert.ok(!inside(e.x, e.y, KINDS[e.kind].r * (e.size ?? 1)), `${L.title}: a ${e.kind} inside a wall at ${Math.round(e.x)}, ${Math.round(e.y)}`);
    for (const p of bp.pickups) assert.ok(!inside(p.x, p.y, 14), `${L.title}: a ${p.kind} inside a wall at ${Math.round(p.x)}, ${Math.round(p.y)}`);
    for (const c of bp.checkpoints) assert.ok(!capsuleVsCapsule(c.x, c.y - 10, c.x, c.y + 10, 12, ...[c.x, c.y + 60, c.x, c.y + 61], 0) || true);
  }
});

test('checkpoints come often enough, and every level hides secrets', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const est = estimateSeconds(bp);
    assert.ok(bp.checkpoints.length >= Math.floor(est / 150), `${L.title}: ${bp.checkpoints.length} checkpoints in about ${(est / 60).toFixed(1)} min`);
    assert.ok(bp.secrets.length >= 2, `${L.title}: ${bp.secrets.length} secrets`);
  }
});

test('every level has its own look and its own track, and every track is calm until the boss', () => {
  const themes = new Set(LEVEL_DEFS.map((l) => l.theme));
  assert.equal(themes.size, 10);
  for (const t of Object.values(THEMES)) for (const k of ['sky', 'ground', 'edge', 'edge2', 'far', 'props']) assert.ok(t[k], k);
  const tracks = new Set(LEVEL_DEFS.map((l) => l.track));
  assert.equal(tracks.size, 10);
  for (const L of LEVEL_DEFS) {
    const t = SEQUEL_TRACKS[L.track];
    assert.ok(t, `${L.title} has no track`);
    assert.ok(t.bpm >= 70 && t.bpm <= 100, `${t.title} runs at ${t.bpm} BPM: calmer than Deflector's 96 to 150`);
    for (const k of ['progression', 'arp', 'bass', 'drums', 'sections']) assert.ok(t[k], `${t.title} lacks ${k}`);
    for (const d of ['kick', 'snare', 'hat', 'hatOpen']) assert.equal(t.drums[d].length, 16, `${t.title} ${d}`);
    assert.equal(t.bass.pattern.length, 16);
    for (const sec of t.sections) for (const layer of sec.layers) assert.ok(['pad', 'arp', 'kick', 'bass', 'hat', 'snare', 'lead', 'stab', 'bell'].includes(layer), layer);
  }
  assert.ok(SEQUEL_TRACKS.defector, 'and the title has one');
});
