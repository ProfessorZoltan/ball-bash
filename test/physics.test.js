import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, circleVsCapsule, polygonEdges, pointInPolygon, predictPath, raycastSegments } from '../src/physics.js';
import { Ball, Fighter, Boss, Spinner, Piston, Orbiter, createMover } from '../src/entities.js';
import { IceTrail } from '../src/ice.js';
import { advanceBall } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';
import { BALL } from '../src/config.js';

const speed = (b) => Math.hypot(b.vx, b.vy);

test('static wall: outgoing speed equals incoming speed, angle mirrored', () => {
  const b = { vx: 300, vy: 400 };
  const ok = reflect(b, -1, 0); // vertical wall, normal pointing -x (ball came from the left)
  assert.equal(ok, true);
  assert.equal(b.vx, -300);
  assert.equal(b.vy, 400);
  assert.ok(Math.abs(speed(b) - 500) < 1e-9);
});

test('separating ball is left alone', () => {
  const b = { vx: -300, vy: 0 };
  assert.equal(reflect(b, -1, 0), false);
  assert.equal(b.vx, -300);
});

test('surface moving toward the ball speeds it up, moving away slows it down', () => {
  const toward = { vx: 400, vy: 0 };
  reflect(toward, -1, 0, -150, 0); // wall moving -x, i.e. toward the ball
  assert.equal(toward.vx, -700); // 400 + 2*150

  const away = { vx: 400, vy: 0 };
  reflect(away, -1, 0, 150, 0); // wall retreating +x
  assert.equal(away.vx, -100); // 400 - 2*150
});

test('asymmetric transfer: closing surfaces use the toward factor, retreating ones the away factor', () => {
  const factor = { toward: 0.7, away: 1.0 };
  const toward = { vx: 400, vy: 0 };
  reflect(toward, -1, 0, -150, 0, 1, factor); // wall closing on the ball at 150
  assert.ok(Math.abs(toward.vx - -610) < 1e-9, `expected -610 (400 + 2*0.7*150), got ${toward.vx}`);
  const away = { vx: 400, vy: 0 };
  reflect(away, -1, 0, 150, 0, 1, factor); // wall retreating at 150
  assert.ok(Math.abs(away.vx - -100) < 1e-9, `expected -100 (400 - 2*150), got ${away.vx}`);
});

test('rotating paddle: the tip swinging into the ball adds speed', () => {
  const f = new Fighter({ x: 0, y: 0, angle: 0, paddleBase: 40, paddleWidth: 100 });
  f.omega = 5; // rad/s, clockwise on screen (y down)
  const seg = f.paddleSegment();
  // Tip "b" is at +y side (perp = (-sin, cos) = (0, 1)). With omega>0 that tip
  // moves in +x ... check via surfaceVelocityAt.
  const sv = f.surfaceVelocityAt(seg.bx, seg.by);
  assert.ok(sv.x < 0, 'tip b moves in -x for positive omega');
  const svA = f.surfaceVelocityAt(seg.ax, seg.ay);
  assert.ok(svA.x > 0, 'tip a moves in +x for positive omega');

  // A ball approaching tip a head-on (moving -x) hits a surface moving +x: speed up.
  const ball = { vx: -300, vy: 0 };
  reflect(ball, 1, 0, svA.x, svA.y);
  assert.ok(ball.vx > 300, `expected faster than 300, got ${ball.vx}`);
});

test('lunge thrust is transferred to the ball', () => {
  const f = new Fighter({ x: 0, y: 0, angle: 0, paddleBase: 40, paddleWidth: 100, lungeExtend: 20, lungeSpeed: 200 });
  f.update(1 / 240, { mx: 0, my: 0, turn: 0, lunge: true });
  assert.equal(f.lungeState, 'out');
  assert.ok(Math.abs(f.paddleVel - 200) < 1e-6);
  const seg = f.paddleSegment();
  const sv = f.surfaceVelocityAt(seg.cx, seg.cy);
  assert.ok(Math.abs(sv.x - 200) < 1e-6);
});

test('capsule overlap reports a normal pointing at the ball', () => {
  const h = circleVsCapsule(5, 20, 10, 0, 0, 0, 100, 2);
  assert.ok(h);
  assert.ok(h.nx > 0.99 && Math.abs(h.ny) < 1e-9);
  assert.ok(Math.abs(h.depth - 7) < 1e-9);
  assert.equal(circleVsCapsule(50, 20, 10, 0, 0, 0, 100, 2), null);
});

test('raycast and path prediction reflect off walls', () => {
  const segs = polygonEdges([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const hit = raycastSegments(50, 50, 1, 0, segs);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 100) < 1e-9);
  assert.ok(hit.nx < 0);
  const path = predictPath(50, 50, 100, 0, segs, 2, 1000);
  assert.equal(path.length, 3);
  assert.ok(path[1].dx < 0, 'second leg travels back the other way');
});

test('spinner tips are moving surfaces: velocity is omega x r', () => {
  const sp = new Spinner({ x: 100, y: 100, length: 200, omega: 2, angle: 0 });
  const [seg] = sp.segments();
  assert.ok(Math.abs(seg.bx - 200) < 1e-9 && Math.abs(seg.by - 100) < 1e-9);
  const v = sp.surfaceVelocityAt(seg.bx, seg.by);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.y - 200) < 1e-9, `tip velocity ${v.x},${v.y}`);
  sp.update(Math.PI / 4);
  assert.ok(Math.abs(sp.angle - Math.PI / 2) < 1e-9);
});

test('piston slides along its axis and reports its sliding velocity', () => {
  const pi = new Piston({ x: 100, y: 100, length: 80, axisAngle: Math.PI / 2, amp: 40, period: 4, phase: 0 });
  let [seg] = pi.segments();
  assert.ok(Math.abs((seg.ay + seg.by) / 2 - 100) < 1e-9, 'starts retracted');
  assert.ok(Math.abs(seg.ax - 140) < 1e-9 && Math.abs(seg.bx - 60) < 1e-9, 'slab is perpendicular to the axis');
  pi.update(2); // half a period: fully extended
  [seg] = pi.segments();
  assert.ok(Math.abs((seg.ay + seg.by) / 2 - 140) < 1e-9, 'fully extended after half a period');
  pi.update(-1); // quarter period: moving outward at peak speed
  const v = pi.surfaceVelocityAt(0, 0);
  assert.ok(v.y > 0 && Math.abs(v.x) < 1e-9, `moving along +y, got ${v.x},${v.y}`);
  const [pred] = pi.predictSegments(1);
  assert.ok(Math.abs((pred.ay + pred.by) / 2 - 140) < 1e-9, 'prediction one second ahead matches the cycle');
});

test('sliding door: slab lies along its axis and slides out to cover the gap', () => {
  const door = new Piston({ x: 100, y: 0, length: 100, axisAngle: 0, amp: 100, period: 4, phase: 0, parallel: true });
  let [seg] = door.segments();
  assert.ok(Math.abs(seg.ay) < 1e-9 && Math.abs(seg.by) < 1e-9, 'horizontal slab');
  assert.ok(Math.abs(Math.min(seg.ax, seg.bx) - 50) < 1e-9 && Math.abs(Math.max(seg.ax, seg.bx) - 150) < 1e-9, 'retracted over 50..150');
  door.update(2);
  [seg] = door.segments();
  assert.ok(Math.abs(Math.min(seg.ax, seg.bx) - 150) < 1e-9 && Math.abs(Math.max(seg.ax, seg.bx) - 250) < 1e-9, 'extended over 150..250');
});

test('orbiter: bars stay tangent to the orbit and move with omega x r', () => {
  const o = new Orbiter({ x: 0, y: 0, radius: 100, count: 2, length: 40, omega: 1, angle: 0 });
  const segs = o.segments();
  assert.equal(segs.length, 2);
  // First bar centred at (100, 0), tangent (vertical).
  assert.ok(Math.abs((segs[0].ax + segs[0].bx) / 2 - 100) < 1e-9 && Math.abs(segs[0].ax - segs[0].bx) < 1e-9);
  const v = o.surfaceVelocityAt(100, 0);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.y - 100) < 1e-9, `expected (0,100), got ${v.x},${v.y}`);
  const [p] = o.predictSegments(Math.PI / 2);
  assert.ok(Math.abs((p.ay + p.by) / 2 - 100) < 1e-9, 'quarter turn later the first bar is at (0,100)');
});

test('orbiting boss: home travels around its ellipse', () => {
  const b = new Boss({ x: 0, y: 0, orbit: { cx: 0, cy: 0, rx: 100, ry: 50, omega: Math.PI, phase: 0 } });
  assert.ok(Math.abs(b.home.x - 100) < 1e-9 && Math.abs(b.home.y) < 1e-9);
  b.updateOrbit(0.5); // half a turn per second at omega = pi
  assert.ok(Math.abs(b.home.x) < 1e-9 && Math.abs(b.home.y - 50) < 1e-9, `expected (0,50), got ${b.home.x},${b.home.y}`);
});

test('ice trail: laid after a block, melts, freezes once per contact', () => {
  const ice = new IceTrail({ lay: 2, life: 2, freeze: 2, width: 30 });
  const ball = { x: 0, y: 0 };
  ice.start(0);
  for (let t = 0; t <= 3; t += 0.1) {
    ball.x = t * 100; // ball travels along +x
    ice.update(t, ball);
  }
  // Laying stopped at t=2 (x=200); by t=3 pieces older than 1s (x < 100) have melted.
  assert.ok(ice.points.every((p) => p.x >= 100 - 1e-6), 'old ice melted');
  assert.ok(ice.points.some((p) => p.x >= 190), 'ice laid up to the end of the lay window');
  assert.ok(!ice.points.some((p) => p.x > 200 + 1e-6), 'no ice after the lay window');

  const f = { x: 150, y: 0, r: 20, frozen: 0, iceImmune: false };
  assert.equal(ice.affect(f), true, 'touching fresh ice freezes');
  assert.equal(f.frozen, 2);
  f.frozen = 0; // thawed but still standing on the ice
  assert.equal(ice.affect(f), false, 'no re-freeze while still on the ice');
  f.x = -500; // step off
  ice.affect(f);
  f.x = 150;
  assert.equal(ice.affect(f), true, 'stepping off and back on freezes again');
  // Sump blocks again: trail restarts empty.
  ice.start(10);
  assert.equal(ice.points.length, 0);
});

for (const def of LEVELS) {
  test(`level ${def.id} arena is sealed: the ball never leaves the room or enters an obstacle`, () => {
    const walls = polygonEdges(def.boundary);
    for (const poly of def.obstacles) walls.push(...polygonEdges(poly));
    const movers = (def.movers || []).map(createMover);
    const player = new Fighter({ x: def.player.x, y: def.player.y, r: 22, paddleWidth: 116, paddleBase: 36 });
    const boss = new Fighter({ ...def.boss, kind: 'boss' });
    const ball = new Ball(BALL.radius);
    const dt = 1 / 240;
    let seed = 1234 + def.id;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    let bounces = 0;
    for (let run = 0; run < 6; run++) {
      // Launch at a random angle at the maximum permitted speed: the worst case for tunnelling.
      ball.launch(def.ball.x, def.ball.y, rnd() * Math.PI * 2, BALL.maxSpeed);
      for (let i = 0; i < 240 * 20; i++) {
        for (const m of movers) m.update(dt);
        // Wiggle the player randomly (moving + spinning paddle) so the ball meets a moving surface often.
        player.update(dt, { mx: rnd() * 2 - 1, my: rnd() * 2 - 1, turn: rnd() * 2 - 1, lunge: rnd() < 0.02 });
        player.finalizeStep(dt);
        boss.update(dt, { mx: 0, my: 0, turn: 1 });
        boss.finalizeStep(dt);
        advanceBall(ball, walls, [player, boss], dt, 1, { onWall: () => bounces++, onBody: () => false }, movers);
        ball.clampSpeed(BALL.minSpeed, BALL.maxSpeed);
        assert.ok(pointInPolygon(ball.x, ball.y, def.boundary), `ball escaped the room at step ${i}: ${ball.x},${ball.y}`);
        for (const poly of def.obstacles) {
          assert.ok(!pointInPolygon(ball.x, ball.y, poly), `ball inside an obstacle at step ${i}`);
        }
      }
    }
    assert.ok(bounces > 100, `expected plenty of wall bounces, saw ${bounces}`);
  });
}
