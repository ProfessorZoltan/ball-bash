// Gravitational lensing, the part worked out without a page: every hole in
// the game bends the picture only inside its reach and not at all at its
// edge; the bend only ever grows, so everything is seen once and every bend
// can be undone; a black hole's shadow sits between its horizon and the ring
// drawn round it; a white hole draws the picture in; what is in front of a
// hole is never bent; and on the screen, where a point is seen undoes what
// the lens pass shows there, so the crosshair and the name tags sit on what
// they mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENS, lensOf, bend, unbend, shadowEdge, weight, lensesFor, sourceOf, seenAt, uvOf, rayAt } from '../src/lens.js';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { MAPS, arenaMap } from '../src/maps.js';
import { camBasis, add, scale, sub, norm, dot } from '../src/math.js';

const holes = () => [...LEVEL_DEFS.flatMap((L) => level(L.id).world.wells.map((w) => [`level ${L.id}`, w])), ...MAPS.flatMap((m) => arenaMap(m.id).world.wells.map((w) => [m.title, w]))];
const TAN = Math.tan((68 * Math.PI) / 180 / 2);
const camera = (eye, yaw, pitch, aspect = 16 / 9) => ({ eye, ...camBasis(yaw, pitch), tx: TAN * aspect, ty: TAN });

test('every hole in the game has a lens, and there are holes both in the levels and in the arenas', () => {
  const all = holes();
  assert.ok(all.some(([at]) => at.startsWith('level')), 'the levels have holes');
  assert.ok(all.some(([at]) => !at.startsWith('level')), 'and so do the arenas');
  for (const [at, w] of all) {
    const L = lensOf(w);
    assert.equal(L.R, w.reach, `${at}: the lens reaches as far as the pull`);
    assert.ok(L.E > w.horizon, `${at}: an Einstein radius wider than the horizon`);
  }
});

test('a hole bends nothing at the edge of its reach or beyond it, nor what is in front of it', () => {
  for (const [at, w] of holes()) {
    const L = lensOf(w);
    for (const b of [L.R, L.R + 0.01, L.R * 2]) assert.equal(bend(b, L), b, `${at}: ${b} m out`);
    assert.ok(Math.abs(bend(L.R * 0.999, L) - L.R * 0.999) < 1e-4, `${at}: fading to nothing at the edge`);
    for (const b of [0.5, 2, 5]) assert.equal(bend(b, L, 0), b, `${at}: in front of the hole`);
  }
});

test('the bend only ever grows, for every hole and every share of it, so each thing is seen once', () => {
  const white = { pull: 2000, reach: 12, horizon: 0.8, white: true };
  for (const [at, w] of [...holes(), ['a white hole', white]]) {
    const L = lensOf(w);
    for (const k of [0.1, 0.5, 1]) {
      let prev = -Infinity;
      for (let b = 0.01; b < L.R + 1; b += 0.01) {
        const s = bend(b, L, k);
        assert.ok(s > prev, `${at}: bend grows at ${b.toFixed(2)} m (k ${k})`);
        prev = s;
      }
    }
  }
});

test('unbend undoes the bend, and the bend undoes unbend', () => {
  const white = { pull: 2000, reach: 12, horizon: 0.8, white: true };
  for (const [at, w] of [...holes(), ['a white hole', white]]) {
    const L = lensOf(w);
    for (const k of [0.3, 1]) {
      for (let b = shadowEdge(L, k) + 0.02; b < L.R; b += 0.37) {
        assert.ok(Math.abs(unbend(bend(b, L, k), L, k) - b) < 1e-6, `${at}: ${b.toFixed(2)} m (k ${k})`);
      }
      for (let s = 0.05; s < L.R; s += 0.41) assert.ok(Math.abs(bend(unbend(s, L, k), L, k) - s) < 1e-6, `${at}: back from ${s.toFixed(2)} m`);
    }
  }
});

test('a black hole\'s shadow reaches past the glowing ring drawn round it, and not past the outer one', () => {
  for (const [at, w] of holes()) {
    const L = lensOf(w);
    const e = shadowEdge(L);
    assert.ok(Math.abs(bend(e, L)) < 1e-9, `${at}: the bend is nothing at the shadow's edge`);
    assert.ok(bend(e * 0.9, L) < 0, `${at}: inside, the light would come from the far side`);
    assert.ok(e > w.horizon * 2 && e < w.horizon * 2.75, `${at}: shadow ${(e / w.horizon).toFixed(2)} horizons out`);
    assert.ok(shadowEdge(L, 0.25) < e && shadowEdge(L, 0) === 0, `${at}: a smaller shadow on what is only just behind`);
  }
  // A stronger pull, a wider shadow.
  const weak = lensOf({ pull: 330, reach: 11, horizon: 0.9 });
  const strong = lensOf({ pull: 4000, reach: 11, horizon: 0.9 });
  assert.ok(shadowEdge(strong) > shadowEdge(weak));
});

test('a white hole draws the picture in toward it and has no shadow', () => {
  const L = lensOf({ pull: 2000, reach: 12, horizon: 0.8, white: true });
  assert.equal(shadowEdge(L), 0);
  assert.equal(bend(0, L), 0);
  for (let b = 0.2; b < L.R; b += 0.5) assert.ok(bend(b, L) > b, `${b} m: shows what is further out`);
});

test('only what stands behind a hole\'s plane is bent, fully once it is well behind', () => {
  const lens = { c: [0, 5, 20], n: [0, 0, 1] };
  assert.equal(weight(lens, [0, 5, 18]), 0, 'in front');
  assert.equal(weight(lens, [3, 0, 20]), 0, 'level with it');
  assert.equal(weight(lens, [0, 5, 20 + LENS.ramp]), 1, 'well behind');
  assert.equal(weight(lens, [0, 5, 400]), 1, 'the sky');
  let prev = 0;
  for (let z = 20; z < 20 + LENS.ramp; z += 0.1) {
    const k = weight(lens, [1, 2, z]);
    assert.ok(k >= prev && k <= 1);
    prev = k;
  }
});

test('the frame\'s lenses: holes in view that are on, nearest first, and none behind the eye', () => {
  const cam = camera([0, 1.5, 0], 0, 0);
  const w = (p, o = {}) => ({ p, pull: 2600, reach: 15, horizon: 0.9, ...o });
  const far = w([0, 5, 60]);
  const near = w([3, 4, 25]);
  const behind = w([0, 4, -20]);
  const off = w([0, 4, 30], { off: true });
  const wide = w([200, 4, 20]);
  const ls = lensesFor(cam, [far, behind, near, off, wide]);
  assert.deepEqual(ls.map((l) => l.c), [near.p, far.p]);
  // A hole just out of view still bends the edge of the view, if its reach comes in.
  const side = lensesFor(cam, [w([22, 2, 12])]);
  assert.equal(side.length, 1);
  const many = lensesFor(cam, Array.from({ length: 7 }, (_, i) => w([i - 3, 3, 20 + i * 5])));
  assert.equal(many.length, LENS.max);
});

test('where a point is seen undoes what the lens pass shows there, whichever way you look', () => {
  const well = { p: [2, 6, 24], pull: 2600, reach: 15, horizon: 0.9 };
  const well2 = { p: [-6, 3, 40], pull: 900, reach: 11, horizon: 0.8 };
  let bent = 0;
  for (const [eye, yaw, pitch] of [[[0, 1.5, 0], 0.05, 0.1], [[4, 2, 5], -0.1, 0.18], [[-3, 8, 10], 0.2, -0.05]]) {
    const cam = camera(eye, yaw, pitch);
    const lenses = lensesFor(cam, [well, well2]);
    assert.equal(lenses.length, 2);
    for (let i = 0; i < 400; i++) {
      // Points round and behind the holes, and the far background.
      const a = i * 2.39996;
      const r = 1.5 + (i % 23) * 0.6;
      const base = i % 2 ? well.p : well2.p;
      const depth = [4, 9, 60][i % 3];
      const p = add(base, [Math.cos(a) * r, Math.sin(a) * r, depth]);
      const uv = seenAt(cam, lenses, p);
      const back = sourceOf(cam, lenses, uv, p);
      const want = uvOf(cam, p);
      assert.ok(!back.shadow, 'what is seen is not in a shadow');
      assert.ok(Math.hypot(back.uv[0] - want[0], back.uv[1] - want[1]) < 1e-6, `a point ${r.toFixed(1)} m out`);
      if (Math.hypot(uv[0] - want[0], uv[1] - want[1]) > 1e-3) bent++;
    }
  }
  assert.ok(bent > 300, `${bent} of the points are seen somewhere else`);
});

test('what is in front of a hole, or out of its reach, is seen where it is', () => {
  const well = { p: [0, 6, 30], pull: 4000, reach: 12, horizon: 0.7 };
  const cam = camera([0, 1.5, 0], 0, 0.15);
  const lenses = lensesFor(cam, [well]);
  for (const p of [[0.5, 6, 25], [1, 5.5, 29.5], [40, 6, 60], [0, 40, 45]]) {
    const uv = seenAt(cam, lenses, p);
    const want = uvOf(cam, p);
    assert.ok(Math.hypot(uv[0] - want[0], uv[1] - want[1]) < 1e-9, `${p}`);
  }
});

test('a black hole pulls the background just behind it out into a ring round its shadow', () => {
  const well = { p: [0, 6, 30], pull: 2600, reach: 15, horizon: 0.9 };
  const cam = camera([0, 6, 0], 0, 0);
  const lenses = lensesFor(cam, [well]);
  const L = lenses[0].L;
  // A point a hand's width off the line through the hole, far behind it, is seen at the shadow's edge.
  const p = [0.05, 6, 400];
  const uv = seenAt(cam, lenses, p);
  const dir = norm(rayAt(cam, uv));
  const b = Math.hypot(...sub(add(cam.eye, scale(dir, 30 / dot(dir, [0, 0, 1]))), well.p));
  assert.ok(b > shadowEdge(L) && b < shadowEdge(L) + 0.2, `seen ${b.toFixed(2)} m out, just outside the shadow at ${shadowEdge(L).toFixed(2)}`);
  // And the middle of the screen, looking straight at the hole, is shadow.
  assert.ok(sourceOf(cam, lenses, [0.5 + 0.004, 0.5], [0, 6, 400]).shadow);
  assert.ok(!sourceOf(cam, lenses, [0.5 + 0.004, 0.5], [0, 6, 28]).shadow, 'unless what is there is in front of the hole');
  // The bend is straight out from the hole: what is behind it is seen the same way from it, further out.
  const far = [3, 9, 200];
  const q = seenAt(cam, lenses, far);
  const w = uvOf(cam, far);
  const a = [(q[0] - 0.5) * cam.tx, (q[1] - 0.5) * cam.ty];
  const b2 = [(w[0] - 0.5) * cam.tx, (w[1] - 0.5) * cam.ty];
  assert.ok(Math.abs(a[0] * b2[1] - a[1] * b2[0]) < 1e-12 && a[0] * b2[0] + a[1] * b2[1] > 0, 'the same way from the hole');
  assert.ok(Math.hypot(...a) > Math.hypot(...b2) * 1.2, 'and further out');
});
