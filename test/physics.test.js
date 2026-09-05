import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, circleVsCapsule, polygonEdges, pointInPolygon, predictPath, raycastSegments } from '../src/physics.js';
import { Ball, Fighter } from '../src/entities.js';
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

test('level 1 arena is sealed: the ball never leaves the room or enters an obstacle', () => {
  const def = LEVELS[0];
  const walls = polygonEdges(def.boundary);
  for (const poly of def.obstacles) walls.push(...polygonEdges(poly));
  const player = new Fighter({ x: def.player.x, y: def.player.y, r: 22, paddleWidth: 116, paddleBase: 36 });
  const boss = new Fighter({ ...def.boss, kind: 'boss' });
  const ball = new Ball(BALL.radius);
  const dt = 1 / 240;
  let seed = 1234;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  let bounces = 0;
  for (let run = 0; run < 6; run++) {
    // Launch at a random angle at the maximum permitted speed: the worst case for tunnelling.
    ball.launch(def.ball.x, def.ball.y, rnd() * Math.PI * 2, BALL.maxSpeed);
    for (let i = 0; i < 240 * 20; i++) {
      // Wiggle the player randomly (moving + spinning paddle) so the ball meets a moving surface often.
      player.update(dt, { mx: rnd() * 2 - 1, my: rnd() * 2 - 1, turn: rnd() * 2 - 1, lunge: rnd() < 0.02 });
      player.finalizeStep(dt);
      boss.update(dt, { mx: 0, my: 0, turn: 1 });
      boss.finalizeStep(dt);
      advanceBall(ball, walls, [player, boss], dt, 1, {
        onWall: () => bounces++,
        onBody: () => false,
      });
      ball.clampSpeed(BALL.minSpeed, BALL.maxSpeed);
      assert.ok(pointInPolygon(ball.x, ball.y, def.boundary), `ball escaped the room at step ${i}: ${ball.x},${ball.y}`);
      for (const poly of def.obstacles) {
        assert.ok(!pointInPolygon(ball.x, ball.y, poly), `ball inside an obstacle at step ${i}`);
      }
    }
  }
  assert.ok(bounces > 100, `expected plenty of wall bounces, saw ${bounces}`);
});
