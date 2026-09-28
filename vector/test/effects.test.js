// High quality's extras, the parts worked out without a page: the sun's
// shadows come in as the levels get real and the grid's bloom goes out; the
// sun's square of shadow is where it should be, stepped in whole texels so
// its edges hold still; roofs, lamps and glass cast nothing; and the shaders
// never ask for a smoothstep backwards (GLSL leaves that undefined, and one
// such fade once put every shadow out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effects, sunBox, toShadowMap, casts } from '../src/effects.js';
import { LEVEL_DEFS, level } from '../src/levels.js';
import * as shaders from '../src/shaders.js';
import { norm, add, scale } from '../src/math.js';

test('the sun casts shadows only once the world is real enough, and the grid glows less as it goes', () => {
  let sun = -1;
  let bloom = Infinity;
  let thresh = -1;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const f = effects(bp.theme, bp.def);
    assert.ok(f.sunlight >= sun, `${L.title}: no less sun than the level before`);
    assert.ok(f.bloom <= bloom, `${L.title}: no more bloom than the level before`);
    assert.ok(f.threshold >= thresh, `${L.title}: it takes no less to glow than the level before`);
    assert.ok(f.shadow <= f.sunlight + 1e-9, `${L.title}: a roof or rain only softens the shadows`);
    if (L.roof || bp.theme.rain) assert.ok(f.shadow < f.sunlight || f.sunlight === 0, `${L.title}: softer under a roof or in rain`);
    sun = f.sunlight;
    bloom = f.bloom;
    thresh = f.threshold;
  }
  const first = effects(level(1).theme, LEVEL_DEFS[0]);
  const last = effects(level(10).theme, LEVEL_DEFS[9]);
  assert.equal(first.shadow, 0, 'the grid has no sun to cast shadows');
  assert.equal(effects(level(2).theme, LEVEL_DEFS[1]).shadow, 0);
  assert.ok(first.bloom > 0.75, 'the grid glows');
  assert.ok(effects(level(8).theme, LEVEL_DEFS[7]).shadow === 1 && effects(level(9).theme, LEVEL_DEFS[8]).shadow === 1, 'the open world at dawn and on the ridge: whole shadows');
  assert.ok(last.bloom < 0.25 && last.bloom > 0, 'the world keeps a trace of glow, on its lamps');
});

test('the sun\'s square: centred ahead of the eye, seen straight down the sun, what stands toward the sun nearer to it', () => {
  for (const sun of [[0.3, 0.9, 0.2], [0.1, 0.12, 1], [0.5, 0.55, 0.4], [0, 1, 0]]) {
    const dir = norm(sun);
    const eye = [12, 5, -40];
    const box = sunBox(eye, [0, 0, 1], dir, 90, 2048, 150);
    const c = toShadowMap(box.vp, box.centre);
    assert.ok(Math.abs(c[0] - 0.5) < 1e-6 && Math.abs(c[1] - 0.5) < 1e-6 && Math.abs(c[2] - 0.5) < 1e-6, 'its middle is the middle of the map');
    const ground = [eye[0] + 3, eye[1] - 1.5, eye[2] + 20];
    const g = toShadowMap(box.vp, ground);
    assert.ok(g.every((v) => v > 0 && v < 1), 'the ground ahead is on the map');
    const up = add(ground, scale(dir, 7));
    const u = toShadowMap(box.vp, up);
    assert.ok(Math.abs(u[0] - g[0]) < 1e-6 && Math.abs(u[1] - g[1]) < 1e-6, 'a point toward the sun lands on the same texel');
    assert.ok(u[2] < g[2], 'and nearer the sun: it shades the ground');
    // Corners of the square, and a little past them.
    const edge = add(add(box.centre, scale(box.x, 44.9)), scale(box.y, -44.9));
    const e = toShadowMap(box.vp, edge);
    assert.ok(e[0] > 0.99 && e[0] < 1 && e[1] < 0.01 && e[1] > 0, 'the square is 90 m across');
    const past = toShadowMap(box.vp, add(box.centre, scale(box.x, 46)));
    assert.ok(past[0] > 1, 'and no more');
    const deep = toShadowMap(box.vp, add(box.centre, scale(dir, 149)));
    assert.ok(deep[2] > 0 && deep[2] < 0.01, 'what stands 150 m toward the sun still casts');
  }
});

test('the sun\'s square moves in whole texels, so a shadow\'s edge holds still as you walk', () => {
  const dir = norm([0.4, 0.8, -0.3]);
  const p = [3.3, 0, 17.7];
  const frac = (v) => ((v * 2048) % 1 + 1) % 1;
  const at = (eye) => toShadowMap(sunBox(eye, [0.2, 0, 1], dir, 90, 2048, 150).vp, p);
  const a = at([0, 1.5, 0]);
  for (const step of [0.013, 0.2, 1.7, 5.3]) {
    const b = at([step * 0.7, 1.5, step]);
    assert.ok(Math.abs(frac(a[0]) - frac(b[0])) < 1e-3 || Math.abs(Math.abs(frac(a[0]) - frac(b[0])) - 1) < 1e-3, `a fixed point sits at the same place in its texel after a step of ${step} m`);
    assert.ok(Math.abs(frac(a[1]) - frac(b[1])) < 1e-3 || Math.abs(Math.abs(frac(a[1]) - frac(b[1])) - 1) < 1e-3);
  }
});

test('roofs, lamps, glass and what is never drawn cast no shadow; walls, floors and scenery do', () => {
  assert.equal(casts({ role: 'roof' }), false);
  assert.equal(casts({ mat: 'lamp' }), false);
  assert.equal(casts({ glass: true }), false);
  assert.equal(casts({ invisible: true }), false);
  assert.equal(casts({ ghost: true }), false);
  for (const role of ['wall', 'floor', 'plat', 'trim', 'arenaWall', 'crusher', 'crate0']) assert.equal(casts({ role }), true, role);
  // An enclosed level's rooms: their roofs are there, and none of them casts.
  const bp = level(4);
  const roofs = bp.world.solids.filter((s) => s.role === 'roof');
  assert.ok(roofs.length > 0 && roofs.every((s) => !casts(s)));
});

test('no shader asks for a smoothstep backwards', () => {
  for (const [name, src] of Object.entries(shaders)) {
    if (typeof src !== 'string') continue;
    for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      assert.ok(Number(m[1]) < Number(m[2]), `${name}: smoothstep(${m[1]}, ${m[2]}, ...) has its edges the wrong way round`);
    }
  }
});

test('the world shader takes the sun\'s shadows, and bloom has every pass it needs', () => {
  for (const k of ['SHADOW_VS', 'SHADOW_FS', 'POST_VS', 'BLOOM_BRIGHT_FS', 'BLOOM_DOWN_FS', 'BLOOM_UP_FS', 'BLOOM_MIX_FS']) assert.ok(typeof shaders[k] === 'string' && shaders[k].startsWith('#version 300 es'), k);
  assert.ok(shaders.WORLD_FS.includes('sampler2DShadow u_shadow'));
  assert.ok(shaders.WORLD_VS.includes('u_shadowVP'));
});
