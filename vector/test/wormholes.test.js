// Wormholes in three dimensions: where an end may sit, how it sits there,
// what goes through and how it comes out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { placeEnd, sightLine, through, turn, exitVelocity, portalSphere, makeEnd } from '../src/wormholes.js';
import { makeCharge, stepCharge } from '../src/blaster.js';
import { Enemy, stepEnemy } from '../src/enemies.js';
import { Robot, standAt } from '../src/player.js';
import { WORM, PHYSICS_DT, MOVE } from '../src/config.js';
import { dot, len, sub, norm } from '../src/math.js';

function room() {
  const w = new World();
  w.box([-20, -1, -20], [20, 0, 20], { role: 'floor' });
  w.box([-20, 0, 20], [20, 8, 21], { role: 'wall' });
  w.box([-21, 0, -20], [-20, 8, 20], { role: 'wall' });
  w.floorY = 0;
  return w;
}

function endAt(w, eye, dir, look = dir, twin = null) {
  return placeEnd(w, sightLine(w, eye, dir).hit, look, twin).end;
}

test('a wall end aimed at eye height opens on the floor, a doorway; the whole mouth on the wall', () => {
  const w = room();
  const e = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  assert.ok(e && e.kind === 'wall');
  assert.ok(Math.abs(e.c[1] - WORM.b) < 1e-9, `centre at ${e.c[1]}`);
  assert.ok(Math.abs(e.c[2] - 20) < 1e-9);
});

test('an end slides along its surface to fit, and refuses a surface too small for it', () => {
  const w = room();
  const e = endAt(w, [19.5, 1.5, 0], norm([0.02, 0, 1]));
  assert.ok(e.c[0] <= 20 - WORM.a + 1e-9, 'slid in from the corner');
  w.box([5, 0, 5], [5.8, 1, 5.8], { role: 'plat' });
  const small = placeEnd(w, sightLine(w, [5.4, 3, 3], norm([0, -1, 1])).hit, [0, 0, 1]);
  assert.equal(small.end, null);
});

test('armoured glass lets the line of sight through and takes no end itself; the wall behind it does', () => {
  const w = room();
  w.box([-3, 0, 10], [3, 5, 10.2], { glass: true, role: 'glass' });
  const e = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  assert.ok(e && e.c[2] > 19, 'the end is on the wall past the glass');
});

test('an end never lies over its twin', () => {
  const w = room();
  const a = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  const b = endAt(w, [0, 1.5, 0], [0, 0, 1], [0, 0, 1], a);
  assert.ok(b && len(sub(a.c, b.c)) >= 2 * Math.max(WORM.a, WORM.b));
});

test('through a pair, a point and a direction come out turned, and speed is kept', () => {
  const w = room();
  const A = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  const B = endAt(w, [0, 1.5, 0], [-1, 0, 0]);
  const v = [0.3, -0.2, 5];
  const out = turn(A, B, v);
  assert.ok(Math.abs(len(out) - len(v)) < 1e-9);
  assert.ok(dot(out, B.n) > 0, 'out of the far mouth, not into it');
  const p = through(A, B, [A.c[0] + 0.2 - A.n[0] * 0.05, A.c[1] + 0.3, A.c[2] - A.n[2] * 0.05]);
  assert.ok(dot(sub(p, B.c), B.n) > 0, 'just in front of the far mouth');
});

test('out of a floor end the robot rises at least fast enough to clear it', () => {
  const w = room();
  const A = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  const F = endAt(w, [0, 1.5, 0], norm([0, -1, 0.2]), [0, 0, 1]);
  assert.equal(F.kind, 'floor');
  const v = exitVelocity(A, F, [0, 0, 1], true);
  assert.ok(dot(v, F.n) >= WORM.floorExit - 1e-9);
});

test('a charge goes through a wormhole and keeps its speed', () => {
  const w = room();
  const A = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  const B = endAt(w, [0, 1.5, 0], [-1, 0, 0]);
  A.twin = B;
  B.twin = A;
  const c = makeCharge([A.c[0], A.c[1], 17], [0, 0, 1]);
  let warped = false;
  for (let i = 0; i < 60 && !warped; i++) warped = stepCharge(c, w, [A, B], PHYSICS_DT).some((e) => e.s === 'warp');
  assert.ok(warped, 'it went through');
  assert.ok(c.vel[0] > 20, 'it came out of the far wall, heading away from it');
});

test('enemies go through wormholes too, and forget their beat where they come out', () => {
  const w = room();
  const A = endAt(w, [0, 1.5, 0], [0, 0, 1]);
  const B = endAt(w, [0, 1.5, 0], [-1, 0, 0]);
  A.twin = B;
  B.twin = A;
  const e = new Enemy({ move: 'flier', look: 'glyph', p: [A.c[0], A.c[1], 17], to: [A.c[0], A.c[1], 30] });
  e.awake = true;
  const bot = new Robot(standAt(0, 0, -10));
  let warped = false;
  for (let i = 0; i < 600 && !warped; i++) warped = stepEnemy(e, w, bot, [A, B], PHYSICS_DT, []).some((x) => x.s === 'warp');
  assert.ok(warped, 'the flier went through');
  assert.equal(e.to, null);
});

test('a launch ramp throws the robot farther than any running jump', () => {
  const w = new World();
  w.box([-50, -1, -10], [50, 0, 10], { role: 'floor' });
  const r = w.ramp([-2.2, 0, -2], [2.2, 2.2, 2.2], 'z', 1, { role: 'ramp' });
  w.floorY = 0;
  const face = r.planes.find((p) => p.slope);
  const R = makeEnd(face.face.c, face.n, face.face.u, face.face.v, r);
  const F = makeEnd([0, 0, -8], [0, 1, 0], [1, 0, 0], [0, 0, 1], w.solids[0]);
  const v = exitVelocity(F, R, [0, -6, 0], true);
  // Flown ballistically, rising light as a thrown robot does.
  let p = [...R.c];
  let vel = [...v];
  const dt = PHYSICS_DT;
  while (p[1] > -0.5 || vel[1] > 0) {
    vel[1] -= (vel[1] > 0 ? MOVE.gUp : MOVE.gFall) * dt;
    p = [p[0] + vel[0] * dt, p[1] + vel[1] * dt, p[2] + vel[2] * dt];
  }
  assert.ok(p[2] - R.c[2] > 11, `thrown ${ (p[2] - R.c[2]).toFixed(1) } m`);
});

test('a sight line bends round a black hole, as a charge does', () => {
  const w = room();
  w.wells.push({ p: [0, 3, 8], pull: 900, reach: 8, horizon: 0.5 });
  const sl = sightLine(w, [2, 1.5, 0], [0, 0, 1]);
  const last = sl.points[sl.points.length - 1];
  assert.ok(Math.abs(last[0] - 2) > 0.2 || sl.swallowed, 'the line bent');
});

void portalSphere;
