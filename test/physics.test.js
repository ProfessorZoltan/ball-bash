import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, circleVsCapsule, polygonEdges, pointInPolygon, predictPath, raycastSegments, closestPointOnSegment } from '../src/physics.js';
import { Ball, Fighter, Boss, Spinner, Piston, Orbiter, Pulser, createMover } from '../src/entities.js';
import { IceTrail } from '../src/ice.js';
import { advanceBall, separateFightersFromBall } from '../src/sim.js';
import { LEVELS, VERSUS_LEVELS, obstaclePoly } from '../src/levels.js';
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

test('signal pulse: the expanding ring flings a ball outward', () => {
  const p = new Pulser({ period: 5, speed: 300, maxRadius: 400, thick: 8, delay: 0 });
  p.update(1 / 240, 0, 0); // emits at t=0 from the origin
  assert.equal(p.active, true);
  assert.equal(p.emitted, true);
  const ball = new Ball(10);
  ball.x = 150;
  ball.y = 0;
  ball.vx = -200; // heading in toward the source
  ball.vy = 0;
  let hits = 0;
  for (let i = 0; i < 240; i++) {
    p.update(1 / 240, 0, 0);
    ball.x += ball.vx / 240;
    advanceBall(ball, [], [], 0, 1, { onMover: () => hits++ }, [p]);
  }
  assert.ok(hits > 0, 'the ring met the ball');
  assert.ok(ball.vx > 200, `ball flung outward faster than it came in, vx=${ball.vx}`);
  // The ring dies at its range.
  for (let i = 0; i < 240 * 2; i++) p.update(1 / 240, 0, 0);
  assert.equal(p.ring(), null);
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

test('ice trail: whoever laid it is immune to it', () => {
  const ice = new IceTrail({ lay: 2, life: 2, freeze: 2, width: 30 });
  ice.start(0, 'b');
  for (let t = 0; t <= 1; t += 0.1) ice.update(t, { x: t * 100, y: 0 });
  const owner = { x: 50, y: 0, r: 20, frozen: 0, iceImmune: false };
  const other = { x: 50, y: 0, r: 20, frozen: 0, iceImmune: false };
  assert.equal(ice.affect(owner, 'b'), false, 'own ice never freezes');
  assert.equal(owner.frozen, 0);
  assert.equal(ice.affect(other, 'a'), true, 'the opponent freezes');
  assert.equal(other.frozen, 2);
});

for (const def of LEVELS) {
  test(`level ${def.id} arena is sealed: the ball never leaves the room or enters an obstacle`, () => {
    const walls = polygonEdges(def.boundary);
    for (const o of def.obstacles) walls.push(...polygonEdges(obstaclePoly(o)));
    const movers = (def.movers || []).map(createMover);
    const player = new Fighter({ x: def.player.x, y: def.player.y, r: 22, paddleWidth: 116, paddleBase: 36 });
    const boss = new Boss({ ...def.boss, kind: 'boss' });
    if (boss.pulser) movers.push(boss.pulser);
    const ball = new Ball(BALL.radius);
    const dt = 1 / 240;
    let seed = 1234 + def.id;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    let bounces = 0;
    for (let run = 0; run < 6; run++) {
      // Launch at a random angle at the maximum permitted speed: the worst case for tunnelling.
      ball.launch(def.ball.x, def.ball.y, rnd() * Math.PI * 2, BALL.maxSpeed);
      for (let i = 0; i < 240 * 20; i++) {
        for (const m of movers) m.update(dt, boss.x, boss.y);
        // Wiggle the player randomly (moving + spinning paddle) so the ball meets a moving surface often.
        player.update(dt, { mx: rnd() * 2 - 1, my: rnd() * 2 - 1, turn: rnd() * 2 - 1, lunge: rnd() < 0.02 });
        player.finalizeStep(dt);
        boss.update(dt, { mx: 0, my: 0, turn: 1 });
        boss.finalizeStep(dt);
        advanceBall(ball, walls, [player, boss], dt, 1, { onWall: () => bounces++, onMover: () => bounces++, onBody: () => false }, movers, def.obstacles.map(obstaclePoly));
        separateFightersFromBall(ball, [player, boss]);
        ball.clampSpeed(BALL.minSpeed, BALL.maxSpeed);
        assert.ok(pointInPolygon(ball.x, ball.y, def.boundary), `ball escaped the room at step ${i}: ${ball.x},${ball.y}`);
        for (const o of def.obstacles) {
          assert.ok(!pointInPolygon(ball.x, ball.y, obstaclePoly(o)), `ball inside an obstacle at step ${i}`);
        }
      }
    }
    assert.ok(bounces > 100, `expected plenty of wall bounces, saw ${bounces}`);
  });
}

test('own-ball rule: a body hit only counts when the other team touched the ball last', async () => {
  const { bodyHitCounts, DEFAULT_RULES, createGameState } = await import('../src/gamestate.js');
  const ball = new Ball(BALL.radius);
  const me = { team: 'us' };
  const mate = { team: 'us' };
  const boss = { team: 'boss' };
  // Default rules: every body hit counts.
  ball.lastTeam = 'us';
  assert.equal(bodyHitCounts(ball, me, DEFAULT_RULES), true);
  assert.equal(bodyHitCounts(ball, me), true);
  // Rule off: a ball my team last hit bounces off me and my co-op partner, still kills the boss.
  const off = { ownBallLoss: false };
  assert.equal(bodyHitCounts(ball, me, off), false);
  assert.equal(bodyHitCounts(ball, mate, off), false);
  assert.equal(bodyHitCounts(ball, boss, off), true);
  ball.lastTeam = 'boss';
  assert.equal(bodyHitCounts(ball, me, off), true);
  assert.equal(bodyHitCounts(ball, boss, off), false);
  // A fresh serve belongs to nobody: both can lose to it.
  ball.launch(0, 0, 0, 300);
  assert.equal(ball.lastTeam, null);
  assert.equal(bodyHitCounts(ball, me, off), true);
  assert.equal(bodyHitCounts(ball, boss, off), true);
  // The rule rides along with the game state and merges over the defaults.
  const g = createGameState(LEVELS[0], { rules: off });
  assert.equal(g.rules.ownBallLoss, false);
  assert.equal(createGameState(LEVELS[0]).rules.ownBallLoss, true);
  // Teams: single player and co-op put the humans together; versus splits them.
  assert.deepEqual(g.fighters.map((f) => [f.slot, f.team]), [['a', 'us'], ['b', 'boss']]);
  const pvp = createGameState(LEVELS[0], { pvp: true });
  assert.deepEqual(pvp.fighters.map((f) => [f.slot, f.team]), [['a', 'a'], ['c', 'c']]);
  const coop = createGameState(LEVELS[0], { coop: true });
  assert.deepEqual(coop.fighters.map((f) => [f.slot, f.team]), [['a', 'us'], ['c', 'us'], ['b', 'boss']]);
  assert.equal(coop.humans.length, 2);
  const three = createGameState(LEVELS[0], { coop: 2 });
  assert.deepEqual(three.fighters.map((f) => [f.slot, f.team]), [['a', 'us'], ['c', 'us'], ['d', 'us'], ['b', 'boss']]);
  assert.equal(three.humans.length, 3);
  assert.notEqual(three.allies[0].color, three.allies[1].color);
});

test('co-op ally spawns are inside every arena and clear of walls, obstacles and movers', async () => {
  const { findAllySpawn, createGameState } = await import('../src/gamestate.js');
  const { PLAYER } = await import('../src/config.js');
  for (const def of LEVELS) {
    const movers = (def.movers || []).map(createMover);
    const s = findAllySpawn(def, movers);
    assert.ok(pointInPolygon(s.x, s.y, def.boundary), `${def.title}: ally spawn inside the room`);
    for (const o of def.obstacles) assert.ok(!pointInPolygon(s.x, s.y, obstaclePoly(o)), `${def.title}: ally spawn not inside an obstacle`);
    const segs = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
    for (const sg of segs) {
      const c = closestPointOnSegment(s.x, s.y, sg.ax, sg.ay, sg.bx, sg.by);
      assert.ok(Math.hypot(c.x - s.x, c.y - s.y) >= PLAYER.radius + 10, `${def.title}: ally spawn clear of walls`);
    }
    const dPlayer = Math.hypot(s.x - def.player.x, s.y - def.player.y);
    assert.ok(dPlayer >= 2 * PLAYER.radius, `${def.title}: ally does not overlap the host`);
    const g = createGameState(def, { coop: true });
    assert.equal(g.ally.x, s.x);
    // A second ally gets its own clear spot, apart from the host and the first ally.
    const g3 = createGameState(def, { coop: 2 });
    const [a1, a2] = g3.allies;
    assert.ok(pointInPolygon(a2.x, a2.y, def.boundary), `${def.title}: second ally inside the room`);
    assert.ok(Math.hypot(a2.x - a1.x, a2.y - a1.y) >= 2 * PLAYER.radius, `${def.title}: allies do not overlap`);
    assert.ok(Math.hypot(a2.x - def.player.x, a2.y - def.player.y) >= 2 * PLAYER.radius, `${def.title}: second ally clear of the host`);
    for (const sg of segs) {
      const c = closestPointOnSegment(a2.x, a2.y, sg.ax, sg.ay, sg.bx, sg.by);
      assert.ok(Math.hypot(c.x - a2.x, c.y - a2.y) >= PLAYER.radius + 10, `${def.title}: second ally clear of walls`);
    }
  }
});

test('keep-moving rule: standing still for the limit loses, a body diameter of net movement resets, turning and freezing do not count', async () => {
  const { tickCamp } = await import('../src/gamestate.js');
  const { PLAYER } = await import('../src/config.js');
  const f = new Fighter({ x: 300, y: 450, angle: 0, kind: 'player' });
  f.resetCamp();
  // Turning in place and jittering below a diameter do not reset the clock.
  let out = false;
  for (let i = 0; i < 240 * (PLAYER.campSeconds - 0.1) && !out; i++) {
    f.angle += 0.01;
    f.x = 300 + (i % 2 ? 20 : -20);
    out = tickCamp(f, 1 / 240);
  }
  assert.equal(out, false);
  assert.ok(f.campTimer > PLAYER.campSeconds - 0.2);
  for (let i = 0; i < 240 * 0.2 && !out; i++) out = tickCamp(f, 1 / 240);
  assert.equal(out, true, `the clock runs out at ${PLAYER.campSeconds} s`);
  // A full diameter of net movement resets the clock.
  f.x = 300;
  f.resetCamp();
  for (let i = 0; i < 240 * 4; i++) tickCamp(f, 1 / 240);
  f.x = 300 + PLAYER.campDistance;
  assert.equal(tickCamp(f, 1 / 240), false);
  assert.equal(f.campTimer, 0);
  assert.equal(f.campX, 300 + PLAYER.campDistance);
  // Frozen time is not counted.
  f.frozen = 2;
  for (let i = 0; i < 240 * 6; i++) assert.equal(tickCamp(f, 1 / 240), false);
  assert.equal(f.campTimer, 0);
});

test('difficulties: shield pools are easy unlimited, normal 5, hard 3, punishing 1', async () => {
  const { DIFFICULTIES, DEFAULT_DIFFICULTY, PLAYER } = await import('../src/config.js');
  const by = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.shields]));
  assert.deepEqual(by, { easy: Infinity, normal: 5, hard: 3, punishing: 1 });
  assert.ok(DIFFICULTIES.some((d) => d.id === DEFAULT_DIFFICULTY));
  assert.equal(PLAYER.campSeconds, 8);
});

test('anticipation: the boss reads the return off the player\'s shield, including a swing', async () => {
  const { predictReturn } = await import('../src/ai.js');
  const walls = polygonEdges([[0, 0], [1600, 0], [1600, 900], [0, 900]], 'wall');
  // A ball heading left at the player, whose shield is tilted 20 degrees.
  const player = new Fighter({ x: 300, y: 450, angle: 20 * Math.PI / 180, kind: 'player' });
  player.paddleOffset = player.paddleBase;
  const seen = { x: 900, y: 450, vx: -500, vy: 0, t: 0 };
  const ret = predictReturn(seen, 0, player, walls, BALL.radius, { swing: false, error: 0 });
  assert.ok(ret, 'the ball meets the shield');
  // A mirror off a plane tilted 20 degrees turns the ball 40 degrees off the straight return.
  const outA = Math.atan2(ret.vy, ret.vx);
  assert.ok(Math.abs(outA - 40 * Math.PI / 180) < 0.03, `return angle ${outA}`);
  assert.ok(Math.abs(Math.hypot(ret.vx, ret.vy) - 500) < 1e-6, 'a still shield keeps the speed');
  assert.ok(ret.t > 0.9 && ret.t < 1.2, `contact time ${ret.t}`);
  // Now the player is pushing into the ball: the swing read sees a faster return.
  player.svx = 300;
  const hot = predictReturn(seen, 0, player, walls, BALL.radius, { swing: true, error: 0 });
  assert.ok(hot && Math.hypot(hot.vx, hot.vy) > 700, `swing read speed ${hot && Math.hypot(hot.vx, hot.vy)}`);
  // A shield turned away from the ball is not read as a return.
  player.svx = 0;
  player.angle = Math.PI;
  assert.equal(predictReturn(seen, 0, player, walls, BALL.radius, { swing: false }), null);
});

test('capsule vs capsule: separated, touching and crossing pairs', async () => {
  const { capsuleVsCapsule, segmentVsSegment } = await import('../src/physics.js');
  // Parallel, 20 apart, radii 6 + 3: no touch.
  assert.equal(capsuleVsCapsule(0, 0, 100, 0, 6, 0, 20, 100, 20, 3), null);
  // 8 apart: overlap of 1, normal pointing from the second toward the first (up, -y).
  let h = capsuleVsCapsule(0, 0, 100, 0, 6, 0, 8, 100, 8, 3);
  assert.ok(h && Math.abs(h.depth - 1) < 1e-9 && h.ny < -0.99, JSON.stringify(h));
  // Crossing: a vertical wall through the middle of a horizontal shield whose
  // body sits at x = -60. The push must carry the far tip (x = 100) clear too.
  const c = segmentVsSegment(0, 0, 100, 0, 50, -50, 50, 50);
  assert.equal(c.d, 0);
  assert.equal(c.crossing, true);
  h = capsuleVsCapsule(0, 0, 100, 0, 6, 50, -50, 50, 50, 0, -60, 0);
  assert.ok(h.nx < -0.99, 'normal faces the body side');
  assert.ok(Math.abs(h.depth - (50 + 6)) < 1e-9, `depth ${h.depth}`);
});

test('fighters touch: bodies, a body on a shield, and shield on shield', async () => {
  const { fightersTouch } = await import('../src/sim.js');
  const a = new Fighter({ x: 100, y: 100, angle: 0, kind: 'player' });
  const b = new Boss({ x: 400, y: 100, angle: Math.PI });
  assert.equal(fightersTouch(a, b), null, 'far apart');
  // Facing each other, shields 36 px in front of each body: touching when the
  // bodies are 2 x 36 + 2 x 6 apart or closer.
  b.x = 100 + 72 + 12 - 1;
  assert.equal(fightersTouch(a, b)?.what, 'shields');
  b.x = 100 + 72 + 12 + 3;
  assert.equal(fightersTouch(a, b), null);
  // The player's body against the boss's shield (player faces away).
  a.angle = Math.PI;
  b.x = 100 + 22 + 36 + 6 - 1;
  assert.equal(fightersTouch(a, b)?.what, 'shield');
  // Bodies pressed together.
  b.angle = 0;
  b.x = 100 + 44;
  assert.equal(fightersTouch(a, b)?.what, 'body');
});

test('every boss turns faster than 3 rad/s and reacts within a third of a second', () => {
  for (const def of LEVELS) {
    assert.ok(def.boss.turnSpeed >= 3.2, `${def.title}: turnSpeed ${def.boss.turnSpeed}`);
    assert.ok(def.boss.reaction <= 0.31, `${def.title}: reaction ${def.boss.reaction}`);
  }
});

for (const def of VERSUS_LEVELS) {
  test(`versus arena ${def.title} is sealed: the ball never leaves the room or enters an obstacle`, async () => {
    const { versusSpawns } = await import('../src/gamestate.js');
    const walls = polygonEdges(def.boundary);
    for (const o of def.obstacles) walls.push(...polygonEdges(obstaclePoly(o)));
    const fighters = versusSpawns(def, 3).map((sp) => new Fighter({ x: sp.x, y: sp.y, angle: sp.angle, r: 22, paddleWidth: 116, paddleBase: 36 }));
    const ball = new Ball(BALL.radius);
    const dt = 1 / 240;
    let seed = 99 + def.boundary.length;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let bounces = 0;
    for (let run = 0; run < 6; run++) {
      ball.launch(def.ball.x, def.ball.y, rnd() * Math.PI * 2, BALL.maxSpeed);
      for (let i = 0; i < 240 * 20; i++) {
        for (const f of fighters) {
          f.update(dt, { mx: rnd() * 2 - 1, my: rnd() * 2 - 1, turn: rnd() * 2 - 1, lunge: rnd() < 0.02 });
          f.finalizeStep(dt);
        }
        advanceBall(ball, walls, fighters, dt, 1, { onWall: () => bounces++, onBody: () => false }, [], def.obstacles.map(obstaclePoly));
        separateFightersFromBall(ball, fighters);
        ball.clampSpeed(BALL.minSpeed, BALL.maxSpeed);
        assert.ok(pointInPolygon(ball.x, ball.y, def.boundary), `ball escaped ${def.title} at step ${i}: ${ball.x},${ball.y}`);
        for (const o of def.obstacles) assert.ok(!pointInPolygon(ball.x, ball.y, obstaclePoly(o)), `ball inside an obstacle at step ${i}`);
      }
    }
    assert.ok(bounces > 50, `only ${bounces} bounces`);
  });
}

test('versus arenas: spawns for 2 and 3 players sit inside the room, clear of walls and each other, and rotate each round', async () => {
  const { versusSpawns, rotateSpawns, createGameState } = await import('../src/gamestate.js');
  const { PLAYER } = await import('../src/config.js');
  for (const def of VERSUS_LEVELS) {
    assert.ok(def.versus, `${def.title} is a versus arena`);
    assert.ok(pointInPolygon(def.ball.x, def.ball.y, def.boundary), `${def.title}: the ball serves inside the room`);
    for (const o of def.obstacles) assert.ok(!pointInPolygon(def.ball.x, def.ball.y, obstaclePoly(o)), `${def.title}: the ball serves clear of obstacles`);
    const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
    for (const n of [2, 3]) {
      const spawns = versusSpawns(def, n);
      assert.equal(spawns.length, n);
      spawns.forEach((sp, i) => {
        assert.ok(pointInPolygon(sp.x, sp.y, def.boundary), `${def.title} spawn ${i} of ${n} is inside the room`);
        for (const o of def.obstacles) assert.ok(!pointInPolygon(sp.x, sp.y, obstaclePoly(o)), `${def.title} spawn ${i} is clear of obstacles`);
        for (const w of walls) {
          const c = closestPointOnSegment(sp.x, sp.y, w.ax, w.ay, w.bx, w.by);
          assert.ok(Math.hypot(c.x - sp.x, c.y - sp.y) >= PLAYER.radius + 10, `${def.title} spawn ${i} of ${n} is ${Math.hypot(c.x - sp.x, c.y - sp.y).toFixed(0)} px from a wall`);
        }
        for (let j = 0; j < i; j++) assert.ok(Math.hypot(spawns[j].x - sp.x, spawns[j].y - sp.y) > 200, `${def.title} spawns ${j} and ${i} are apart`);
      });
      const g = createGameState(def, { pvp: n });
      assert.deepEqual(g.fighters.map((f) => f.slot), ['a', 'c', 'd'].slice(0, n));
      assert.deepEqual(g.humans.map((f) => f.team), ['a', 'c', 'd'].slice(0, n));
      assert.equal(g.players, n);
      assert.equal(g.coop, false);
      // Round 1 seats everyone at their own spawn; round 2 moves each seat one along; round n + 1 is round 1 again.
      assert.deepEqual(rotateSpawns(spawns, 1), spawns);
      assert.deepEqual(rotateSpawns(spawns, 2)[0], spawns[1]);
      assert.deepEqual(rotateSpawns(spawns, n + 1), spawns);
    }
  }
  // Every campaign level seats a third player in an open spot well away from the other two.
  for (const def of LEVELS) {
    const three = versusSpawns(def, 3);
    assert.equal(three.length, 3);
    const t = three[2];
    assert.ok(pointInPolygon(t.x, t.y, def.boundary), `${def.title}: third seat inside the room`);
    for (const o of def.obstacles) assert.ok(!pointInPolygon(t.x, t.y, obstaclePoly(o)), `${def.title}: third seat clear of obstacles`);
    const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
    for (const w of walls) {
      const c = closestPointOnSegment(t.x, t.y, w.ax, w.ay, w.bx, w.by);
      assert.ok(Math.hypot(c.x - t.x, c.y - t.y) >= PLAYER.radius + 30, `${def.title}: third seat has room`);
    }
    const d1 = Math.hypot(t.x - three[0].x, t.y - three[0].y);
    const d2 = Math.hypot(t.x - three[1].x, t.y - three[1].y);
    assert.ok(Math.min(d1, d2) >= 300, `${def.title}: third seat is ${Math.round(Math.min(d1, d2))} px from the nearest other seat`);
    assert.ok(Math.abs(d1 - d2) <= 0.35 * Math.max(d1, d2), `${def.title}: third seat is even-handed (${Math.round(d1)} vs ${Math.round(d2)})`);
  }
});

// ------------------------------------------------------------ conduits

test('conduits: the sequence interleaves them after their levels, and campaign modes step through it', async () => {
  const { CONDUITS, SEQUENCE, campaignNextIndex, levelLabel, shortId, CONDUIT_MAX_SPEED } = await import('../src/conduits.js');
  assert.equal(SEQUENCE.length, LEVELS.length + CONDUITS.length);
  assert.equal(SEQUENCE[0], LEVELS[0]);
  for (const c of CONDUITS) {
    const i = SEQUENCE.indexOf(c);
    assert.ok(i > 0 && SEQUENCE[i - 1].id === c.after, `${c.title} follows level ${c.after}`);
    assert.equal(c.maxBallSpeed, CONDUIT_MAX_SPEED);
    assert.equal(CONDUIT_MAX_SPEED, BALL.maxSpeed / 2);
  }
  assert.equal(levelLabel(LEVELS[2]), 'Level 3');
  assert.equal(levelLabel(CONDUITS[0]), 'Conduit 1½');
  assert.equal(shortId(LEVELS[0]), '01');
  // Short mode skips conduits; full mode visits them; both end after the last level.
  const first = SEQUENCE.indexOf(LEVELS[0]);
  assert.equal(SEQUENCE[campaignNextIndex(first, 'short')], LEVELS[1]);
  assert.equal(SEQUENCE[campaignNextIndex(first, 'full')], CONDUITS[0]);
  assert.equal(SEQUENCE[campaignNextIndex(SEQUENCE.indexOf(CONDUITS[0]), 'full')], LEVELS[1]);
  assert.equal(campaignNextIndex(SEQUENCE.length - 1, 'full'), -1);
  assert.equal(campaignNextIndex(SEQUENCE.length - 1, 'short'), -1);
});

test('nodes: plain, ricochet, hooded and fast conditions', async () => {
  const { nodeAccepts } = await import('../src/gamestate.js');
  const fromRight = { nx: 1, ny: 0 };
  const fromLeft = { nx: -1, ny: 0 };
  const slow = { vx: -300, vy: 0 };
  const quick = { vx: -700, vy: 0 };
  const ball = { banked: false, speed: 300 };
  assert.equal(nodeAccepts({ kind: 'plain' }, fromLeft, slow, ball), true);
  assert.equal(nodeAccepts({ kind: 'ricochet' }, fromLeft, slow, ball), false, 'straight from the shield');
  assert.equal(nodeAccepts({ kind: 'ricochet' }, fromLeft, slow, { ...ball, banked: true }), true, 'after a wall');
  assert.equal(nodeAccepts({ kind: 'hooded', open: 0, arc: 110 }, fromRight, slow, ball), true, 'into the open side');
  assert.equal(nodeAccepts({ kind: 'hooded', open: 0, arc: 110 }, fromLeft, slow, ball), false, 'into the hood');
  assert.equal(nodeAccepts({ kind: 'hooded', open: 0, arc: 110 }, { nx: Math.cos(0.9), ny: Math.sin(0.9) }, slow, ball), true, 'inside a 110 degree opening');
  assert.equal(nodeAccepts({ kind: 'hooded', open: 0, arc: 110 }, { nx: Math.cos(1.1), ny: Math.sin(1.1) }, slow, ball), false, 'outside it');
  assert.equal(nodeAccepts({ kind: 'fast', minSpeed: 600 }, fromLeft, slow, ball), false);
  assert.equal(nodeAccepts({ kind: 'fast', minSpeed: 600 }, fromLeft, quick, ball), true);
  assert.equal(nodeAccepts({ kind: 'plain', minSpeed: 600 }, fromLeft, slow, ball), false, 'minSpeed applies to any kind');
});

test('conduit game state: nodes are solid, drones stand in for the boss, the cap is half speed, and lighting everything clears it', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState, objectiveDone } = await import('../src/gamestate.js');
  for (const def of CONDUITS) {
    const g = createGameState(def);
    assert.equal(g.maxSpeed, BALL.maxSpeed / 2);
    assert.equal(g.nodes.length, (def.nodes || []).length);
    assert.equal(g.drones.length, def.drones.length);
    assert.equal(g.vents.length, (def.vents || []).length);
    assert.equal(g.boss, g.drones[0]);
    assert.ok(g.fighters.includes(g.drones[0]));
    if (g.nodes.length) assert.ok(g.walls.some((w) => w.kind === 'node' && w.node === g.nodes[0]), 'node walls carry their node');
    assert.ok(pointInPolygon(def.player.x, def.player.y, def.boundary) && pointInPolygon(def.ball.x, def.ball.y, def.boundary));
    for (const n of g.nodes) {
      assert.ok(pointInPolygon(n.x, n.y, def.boundary), `${def.title}: node ${n.i} inside the room`);
      for (const o of def.obstacles) assert.ok(!pointInPolygon(n.x, n.y, obstaclePoly(o)), `${def.title}: node ${n.i} clear of obstacles`);
    }
    assert.equal(objectiveDone(g), false);
    for (const n of g.nodes) n.lit = true;
    assert.equal(objectiveDone(g), g.objective.drones === 0 && g.objective.turrets === 0);
    for (const d of g.drones) d.down = true;
    for (const t of g.turrets) t.down = true;
    assert.equal(objectiveDone(g), true);
  }
});

for (const def of (await import('../src/conduits.js')).CONDUITS) {
  test(`conduit ${def.title} is sealed at its half-speed cap: the ball never leaves the room or enters a node`, async () => {
    const { createGameState } = await import('../src/gamestate.js');
    const g = createGameState(def);
    const ball = g.ball;
    const dt = 1 / 240;
    let seed = 77;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let bounces = 0;
    for (let run = 0; run < 6; run++) {
      ball.launch(def.ball.x, def.ball.y, rnd() * Math.PI * 2, g.maxSpeed);
      for (let i = 0; i < 240 * 20; i++) {
        for (const m of g.movers) m.update(dt, g.boss.x, g.boss.y);
        g.player.update(dt, { mx: rnd() * 2 - 1, my: rnd() * 2 - 1, turn: rnd() * 2 - 1, lunge: rnd() < 0.02 });
        g.player.finalizeStep(dt);
        for (const d of g.drones) {
          d.update(dt, { mx: 0, my: 0, turn: 1 });
          d.finalizeStep(dt);
        }
        advanceBall(ball, g.walls, g.fighters, dt, 1, { onWall: () => bounces++, onMover: () => bounces++, onBody: () => false }, g.movers, g.solidPolys);
        separateFightersFromBall(ball, g.fighters);
        ball.clampSpeed(BALL.minSpeed, g.maxSpeed);
        assert.ok(pointInPolygon(ball.x, ball.y, def.boundary), `ball escaped ${def.title} at step ${i}: ${ball.x},${ball.y}`);
        for (const poly of g.solidPolys) assert.ok(!pointInPolygon(ball.x, ball.y, poly), `ball inside an obstacle or node at step ${i}`);
        assert.ok(ball.speed <= g.maxSpeed + 1e-6, `ball over the cap: ${ball.speed}`);
      }
    }
    assert.ok(bounces > 50, `only ${bounces} bounces`);
  });
}

test('ice patches: a vent patch freezes a fighter on it, melts after patchLife, and rides along in a snapshot', async () => {
  const { IceTrail } = await import('../src/ice.js');
  const { buildSnapshot, applySnapshot } = await import('../src/netstate.js');
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState } = await import('../src/gamestate.js');
  const ice = new IceTrail({ lay: 1, life: 1, freeze: 1.5, width: 30, patchLife: 4 });
  const f = new Fighter({ x: 100, y: 100, kind: 'player' });
  ice.addPatch(400, 400, 48, 10);
  ice.update(10, { x: 0, y: 0 });
  assert.equal(ice.affect(f, 'a'), false, 'far from the patch');
  f.x = 430;
  f.y = 400;
  assert.equal(ice.affect(f, 'a'), true, 'stepping onto the patch freezes');
  assert.equal(f.frozen, 1.5);
  ice.update(14.5, { x: 0, y: 0 });
  assert.equal(ice.patches.length, 0, 'melted after patchLife');
  // Snapshot round trip carries the patches.
  const def = CONDUITS.find((c) => c.vents && c.vents.length);
  const src = createGameState(def);
  const dst = createGameState(def);
  src.ice.addPatch(250, 250, 48, 3);
  src.time = 3;
  const snap = JSON.parse(JSON.stringify(buildSnapshot(src, { st: 'playing' })));
  applySnapshot(dst, snap);
  assert.deepEqual(dst.ice.patches, [{ x: 250, y: 250, r: 48, t: 3 }]);
  // Vents are scheduled from their delay.
  assert.deepEqual(src.vents.map((v) => v.nextAt), def.vents.map((v) => v.delay));
});

test('energy shots: a shield deflects one (with its motion), a body stops it, a wall stops it, and turrets are solid discs with an objective', async () => {
  const { advanceShot, Shot } = await import('../src/sim.js');
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState, objectiveDone } = await import('../src/gamestate.js');
  const walls = polygonEdges([[0, 0], [600, 0], [600, 400], [0, 400]], 'wall');
  const f = new Fighter({ x: 300, y: 200, angle: Math.PI, kind: 'player' }); // shield 36 px to the left of the body
  // Straight at the shield from the left.
  let shot = new Shot(200, 200, 260, 0, 8, 0, 0);
  let hit = null;
  for (let i = 0; i < 240 && !hit; i++) hit = advanceShot(shot, walls, [f], 1 / 240);
  assert.equal(hit && hit.kind, 'paddle');
  assert.ok(shot.vx < 0, 'sent back the way it came');
  // Into the body from behind (the shield is on the other side).
  shot = new Shot(400, 200, -260, 0, 8, 0, 0);
  hit = null;
  for (let i = 0; i < 240 && !hit; i++) hit = advanceShot(shot, walls, [f], 1 / 240);
  assert.equal(hit && hit.kind, 'body');
  assert.equal(hit.f, f);
  // Into a wall.
  shot = new Shot(100, 100, 0, -260, 8, 0, 0);
  hit = null;
  for (let i = 0; i < 240 && !hit; i++) hit = advanceShot(shot, walls, [], 1 / 240);
  assert.equal(hit && hit.kind, 'wall');
  // A conduit with turrets: solid, scheduled, and part of the objective.
  const def = CONDUITS.find((c) => c.turrets && c.turrets.length);
  const g = createGameState(def);
  assert.equal(g.turrets.length, def.turrets.length);
  assert.ok(g.walls.some((w) => w.kind === 'turret' && w.turret === g.turrets[0]));
  assert.ok(g.solidPolys.some((poly) => pointInPolygon(g.turrets[0].x, g.turrets[0].y, poly)), 'the turret disc is solid');
  assert.equal(g.objective.turrets, def.turrets.length);
  for (const n of g.nodes) n.lit = true;
  assert.equal(objectiveDone(g), false, 'turrets still up');
  for (const t of g.turrets) t.down = true;
  assert.equal(objectiveDone(g), true);
  // A deflected shot into a turret disc is a wall hit carrying the turret.
  const t = g.turrets[0];
  shot = new Shot(t.x, t.y + 120, 0, -260, 8, 0, 0);
  shot.deflected = true;
  hit = null;
  for (let i = 0; i < 480 && !hit; i++) hit = advanceShot(shot, g.walls, [], 1 / 240, g.movers);
  assert.equal(hit && hit.kind, 'wall');
  assert.equal(hit.seg.turret, t);
});

test('signal box: switches flip doors into and out of the walls, carts stay on their rails, and only the exit node counts', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState, rebuildWalls, constrainToRail, objectiveDone } = await import('../src/gamestate.js');
  const def = CONDUITS.find((c) => c.doors && c.doors.length);
  const g = createGameState(def);
  assert.equal(g.doors.length, def.doors.length);
  const doorSegs = () => g.walls.filter((w) => w.kind === 'door').length;
  const before = doorSegs();
  assert.ok(before > 0, 'closed doors are walls');
  assert.ok(g.solidPolys.includes(g.doors[0].poly), 'closed doors are solid');
  g.doors[0].closed = false;
  rebuildWalls(g);
  assert.equal(doorSegs(), before - g.doors[0].segs.length, 'an open door leaves the walls');
  assert.ok(!g.solidPolys.includes(g.doors[0].poly));
  g.doors[0].closed = true;
  rebuildWalls(g);
  assert.equal(doorSegs(), before);
  // Rails.
  const cart = g.drones[0];
  assert.ok(cart.rail, 'the first drone is a cart');
  cart.x = cart.rail.ax + 40;
  cart.y = 300;
  cart.vx = 50;
  cart.vy = -100;
  constrainToRail(cart, cart.rail);
  assert.equal(cart.x, cart.rail.ax);
  assert.equal(cart.y, 300);
  assert.equal(cart.vx, 0);
  assert.equal(cart.vy, -100);
  cart.y = cart.rail.by + 500;
  constrainToRail(cart, cart.rail);
  assert.equal(cart.y, cart.rail.by, 'clamped to the rail end');
  // Objective: the exit alone.
  const exit = g.nodes.find((n) => n.kind !== 'switch');
  assert.equal(objectiveDone(g), false);
  exit.lit = true;
  assert.equal(objectiveDone(g), true, 'switches need not be on');
  // Every switch's doors exist, and the exit sits inside its bay behind the third door.
  for (const n of g.nodes) if (n.kind === 'switch') for (const i of n.toggles) assert.ok(g.doors[i], `switch ${n.i} wires door ${i}`);
  assert.ok(pointInPolygon(exit.x, exit.y, def.boundary));
});

test('reliquary: only the amber pane breaks, at its own speed under the cap; the relic sits in the apse behind it', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState } = await import('../src/gamestate.js');
  const def = CONDUITS.find((c) => c.glass && c.conduit);
  const g = createGameState(def);
  assert.equal(g.panes.length, 3);
  const breakable = g.panes.filter((p) => !p.unbreakable);
  assert.equal(breakable.length, 1, 'one honest pane');
  assert.ok(def.glass.breakSpeed < def.maxBallSpeed, 'the break speed is reachable under the cap');
  assert.ok(def.glass.breakSpeed > def.ball.speed, 'but not at serve speed');
  assert.ok(g.walls.filter((w) => w.kind === 'glass').length === g.panes.reduce((n, p) => n + p.segs.length, 0), 'every pane is a wall while whole');
  // The relic is inside the room, right of the glass, and the player is left of it.
  const relic = g.nodes[0];
  assert.ok(pointInPolygon(relic.x, relic.y, def.boundary));
  const paneX = breakable[0].poly.reduce((s, p) => s + p[0], 0) / breakable[0].poly.length;
  assert.ok(relic.x > paneX && def.player.x < paneX);
  // Choristers loop the nave.
  for (const d of g.drones) assert.ok(d.orbit, 'choristers have an orbit');
});

test('lamplighter: candles are nodes, the exit waits on the candles beside it, the lanterns loop in the dark, and the guide is off', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState, objectiveDone } = await import('../src/gamestate.js');
  const def = CONDUITS.find((c) => c.dark && c.conduit);
  assert.ok(def.noGuide, 'no guide line');
  assert.ok(def.dark.hidden < def.dark.boss, 'a shuttered lantern shows less than an open one');
  const g = createGameState(def);
  const candles = g.nodes.filter((n) => n.kind === 'candle');
  const exit = g.nodes.find((n) => n.requires);
  assert.equal(candles.length, 5);
  assert.ok(exit && exit.requires.every((i) => g.nodes[i].kind === 'candle'), 'the exit waits on candles');
  for (const d of g.drones) assert.ok(d.lantern && d.orbit, 'lanterns loop');
  for (const n of g.nodes) assert.ok(pointInPolygon(n.x, n.y, def.boundary));
  for (const n of g.nodes) for (const o of def.obstacles) assert.ok(!pointInPolygon(n.x, n.y, obstaclePoly(o)));
  for (const n of candles) n.lit = true;
  assert.equal(objectiveDone(g), false, 'the exit is still dark');
  exit.lit = true;
  assert.equal(objectiveDone(g), true);
});

test('relay mast: floor emitters pulse on their own clocks, the rings reach guests in a snapshot, and the receiver is hooded', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState } = await import('../src/gamestate.js');
  const { buildSnapshot, applySnapshot } = await import('../src/netstate.js');
  const def = CONDUITS.find((c) => c.emitters && c.emitters.length);
  const g = createGameState(def);
  assert.equal(g.emitters.length, 2);
  const [a, b] = g.emitters.map((e) => e.pulser);
  assert.equal(a.active, false);
  // Run the emitters to the first pulse of each.
  for (let t = 0; t < 8; t += 1 / 240) for (const e of g.emitters) e.pulser.update(1 / 240, e.x, e.y);
  assert.ok(a.nextAt > 5 && !a.active, 'the first pulsed at 5 s and its ring has faded by 8 s');
  assert.ok(b.active, 'the second pulsed at 7.5 s and its ring is still out');
  assert.ok(Math.abs(Math.abs(a.nextAt - b.nextAt) - 2.5) < 0.01, `half a period apart: ${a.nextAt} vs ${b.nextAt}`);
  assert.ok(b.ring() && b.ring().r > 0 && b.ring().x === g.emitters[1].x, 'the ring is where the emitter is');
  // The snapshot carries the rings.
  const mirror = createGameState(def);
  const snap = JSON.parse(JSON.stringify(buildSnapshot(g, { st: 'playing' })));
  applySnapshot(mirror, snap);
  const m = mirror.emitters[1].pulser;
  assert.equal(m.active, true);
  assert.ok(Math.abs(m.radius - b.radius) < 0.11 && Math.abs(m.t - b.t) < 0.11);
  assert.equal(m.x, g.emitters[1].x);
  // The receiver faces the lob.
  const node = g.nodes[0];
  assert.equal(node.kind, 'hooded');
  assert.ok(node.open < 0, 'opens upward');
  assert.ok(g.turrets.length === 2 && g.objective.turrets === 0, 'turrets harass but are not the job');
});

test('event horizon: the well pulls harder up close and not at all beyond its reach, the serve slingshots past it, the guide bends, and the shadow phases', async () => {
  const { CONDUITS } = await import('../src/conduits.js');
  const { createGameState, wellField, wellDrag, wellSwallows, dronePhased } = await import('../src/gamestate.js');
  const { predictCurvedPath } = await import('../src/physics.js');
  const { buildSnapshot, applySnapshot } = await import('../src/netstate.js');
  const def = CONDUITS.find((c) => c.well);
  const g = createGameState(def);
  const w = g.well;
  assert.ok(pointInPolygon(w.x, w.y, def.boundary));
  assert.equal(wellField(w, w.x + w.range + 1, w.y), null, 'nothing beyond its reach');
  const near = wellField(w, w.x + 100, w.y);
  const far = wellField(w, w.x + 250, w.y);
  assert.ok(near.k > far.k && near.ux === -1 && Math.abs(near.uy) < 1e-9, 'stronger up close, pointing at the well');
  assert.ok(wellField(w, w.x, w.y + w.range - 1).k < far.k * 0.05, 'fades out at the edge');
  assert.ok(Math.hypot(def.player.x - w.x, def.player.y - w.y) > w.range, 'the spawn is out of reach');
  assert.ok(Math.hypot(g.nodes[0].x - w.x, g.nodes[0].y - w.y) > w.range, 'so is the node');
  // Free flight under the pull, the way moveBall applies it.
  const fly = (x, y, deg, secs) => {
    const a = (deg * Math.PI) / 180;
    const b = { x, y, vx: Math.cos(a) * def.ball.speed, vy: Math.sin(a) * def.ball.speed };
    const dt = 1 / 240;
    for (let t = 0; t < secs; t += dt) {
      const p = wellField(w, b.x, b.y);
      if (p) {
        b.vx += p.ux * w.pull * p.k * dt;
        b.vy += p.uy * w.pull * p.k * dt;
      }
      const s = Math.hypot(b.vx, b.vy);
      const c = Math.max(BALL.minSpeed, Math.min(g.maxSpeed, s));
      b.vx *= c / s;
      b.vy *= c / s;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (wellSwallows(w, b.x, b.y)) return { swallowed: true, b };
    }
    return { swallowed: false, b };
  };
  for (const deg of [def.ball.angleDeg - 14, def.ball.angleDeg, def.ball.angleDeg + 14]) {
    const r = fly(def.ball.x, def.ball.y, deg, 2.5);
    assert.ok(!r.swallowed && r.b.x > w.x + w.range, `the serve at ${deg}° comes out the far side (${r.swallowed}, ${r.b.x})`);
  }
  assert.ok(fly(def.player.x, def.player.y, 0, 3).swallowed, 'a straight shot at the well is taken');
  // The guide bends the same way: heading up-right from the player's side, it crosses the well's column lower than a straight line would.
  const crossY = (path, x) => {
    for (const leg of path) if (leg.ax <= x && leg.bx >= x) return leg.ay + ((leg.by - leg.ay) * (x - leg.ax)) / (leg.bx - leg.ax);
    return null;
  };
  const accel = (x, y) => {
    const p = wellField(w, x, y);
    return p ? { ax: p.ux * w.pull * p.k, ay: p.uy * w.pull * p.k } : null;
  };
  const opts = { bounces: 1, maxDist: 900, radius: BALL.radius, speed: [BALL.minSpeed, g.maxSpeed], stop: (x, y) => wellSwallows(w, x, y) };
  const straight = predictPath(300, 450, 400, -160, g.walls, 1, 900, BALL.radius);
  const flat = predictCurvedPath(300, 450, 400, -160, g.walls, () => null, opts);
  const bent = predictCurvedPath(300, 450, 400, -160, g.walls, accel, opts);
  assert.ok(Math.abs(crossY(flat, 700) - crossY(straight, 700)) < 1, 'with no field the curved guide is the straight one');
  assert.ok(crossY(bent, 800) > crossY(straight, 800) + 40, `pulled toward the well: ${crossY(bent, 800)} vs ${crossY(straight, 800)}`);
  assert.ok(bent.length > 20, 'many short legs');
  const into = predictCurvedPath(300, 450, 400, 0, g.walls, accel, opts);
  const end = into[into.length - 1];
  assert.ok(wellSwallows(w, end.bx, end.by), 'a guide aimed at the well ends at the horizon');
  // A player inside the reach drifts toward the well, and their body counts before their centre does.
  const f = g.player;
  f.x = w.x - 200;
  f.y = w.y;
  wellDrag(w, f, 1 / 240);
  assert.ok(f.x > w.x - 200 && f.y === w.y, 'dragged straight at it');
  assert.ok(wellSwallows(w, w.x - w.r - 5, w.y, f.r) && !wellSwallows(w, w.x - w.r - 5, w.y));
  assert.deepEqual(f.spawn, { x: def.player.x, y: def.player.y, angle: def.player.angle });
  // The shadow: an orbit round the well, solid `on` seconds then gone `off`.
  const d = g.drones[0];
  assert.ok(d.orbit && d.orbit.cx === w.x && d.orbit.cy === w.y, 'circles the well');
  assert.ok(d.orbit.rx < w.range && d.orbit.rx > w.r + d.r, 'inside the pull, outside the horizon');
  assert.equal(d.phased, false);
  assert.equal(dronePhased(d.phasing, 0), false);
  assert.equal(dronePhased(d.phasing, d.phasing.on + 0.1), true);
  assert.equal(dronePhased(d.phasing, d.phasing.on + d.phasing.off + 0.1), false);
  assert.equal(g.objective.drones, 1, 'downing it is the job');
  d.phased = true;
  const mirror = createGameState(def);
  applySnapshot(mirror, JSON.parse(JSON.stringify(buildSnapshot(g, { st: 'playing' }))));
  assert.equal(mirror.drones[0].phased, true, 'the phase reaches guests');
});

test('drafting room: one of everything, the signature waits on the rest, the bay is shut and glazed, and the turret is the job', async () => {
  const { CONDUITS, SEQUENCE } = await import('../src/conduits.js');
  const { createGameState, objectiveDone, rebuildWalls } = await import('../src/gamestate.js');
  const def = CONDUITS.find((c) => c.title === 'Drafting Room');
  assert.equal(SEQUENCE[SEQUENCE.length - 2], def, 'the last stop before the Arcade');
  assert.equal(SEQUENCE[SEQUENCE.length - 1], LEVELS[LEVELS.length - 1], 'which ends the sequence');
  assert.equal(SEQUENCE[SEQUENCE.length - 3], LEVELS[LEVELS.length - 2], 'it follows Nullspace');
  const g = createGameState(def);
  const kinds = g.nodes.map((n) => n.kind);
  for (const k of ['ricochet', 'hooded', 'switch', 'plain']) assert.ok(kinds.includes(k), `a ${k} node`);
  assert.equal(g.doors.length, 1);
  assert.equal(g.panes.length, 1);
  assert.equal(g.turrets.length, 1);
  assert.equal(g.vents.length, 2);
  assert.ok(g.ice, 'vents need ice');
  assert.ok(g.drones.length === 1 && g.drones[0].rail, 'a cart on a rail');
  assert.ok(g.movers.length === 1 && g.movers[0].kind === 'spinner', 'the prism');
  assert.ok(def.glass.breakSpeed > def.ball.speed && def.glass.breakSpeed < def.maxBallSpeed, 'the strike is earned under the cap');
  // Everything sits inside the room and outside the solids.
  for (const n of g.nodes) {
    assert.ok(pointInPolygon(n.x, n.y, def.boundary), `node ${n.i} inside`);
    for (const poly of g.solidPolys) if (!pointInPolygon(n.x, n.y, ellipseAt(n))) assert.ok(!pointInPolygon(n.x, n.y, poly), `node ${n.i} clear of solids`);
  }
  for (const t of g.turrets) assert.ok(pointInPolygon(t.x, t.y, def.boundary));
  for (const v of g.vents) assert.ok(pointInPolygon(v.x, v.y, def.boundary));
  // The switch opens the door; the strike node is inside the bay behind the door and the pane.
  const door = g.doors[0];
  const sw = g.nodes.find((n) => n.kind === 'switch');
  assert.deepEqual(sw.toggles, [0]);
  assert.ok(door.closed && g.solidPolys.includes(door.poly), 'shut to start');
  const strike = g.nodes[3];
  const doorX = door.poly.reduce((s, p) => s + p[0], 0) / door.poly.length;
  const paneX = g.panes[0].poly.reduce((s, p) => s + p[0], 0) / g.panes[0].poly.length;
  assert.ok(strike.x > paneX && paneX > doorX && doorX > def.player.x, 'door, then glass, then the node');
  // The signature waits on the bank, the hood and the strike; the switch never counts; the turret does.
  const sig = g.nodes[4];
  assert.deepEqual(sig.requires, [0, 1, 3]);
  assert.equal(g.objective.turrets, 1);
  for (const i of [0, 1, 3, 4]) g.nodes[i].lit = true;
  assert.equal(objectiveDone(g), false, 'the turret is still up');
  g.turrets[0].down = true;
  assert.equal(objectiveDone(g), true, 'switch off, everything else done');
  door.closed = false;
  rebuildWalls(g);
  assert.ok(!g.solidPolys.includes(door.poly));
  // The hood opens from below only: a ball rising into it qualifies, one arriving from the left does not.
  const { nodeAccepts } = await import('../src/gamestate.js');
  const hood = g.nodes[1];
  assert.equal(nodeAccepts(hood, { nx: 0, ny: 1 }, { vx: 0, vy: -400 }, g.ball), true);
  assert.equal(nodeAccepts(hood, { nx: -1, ny: 0 }, { vx: 400, vy: 0 }, g.ball), false);
  function ellipseAt(n) {
    return [[n.x - n.r - 1, n.y - n.r - 1], [n.x + n.r + 1, n.y - n.r - 1], [n.x + n.r + 1, n.y + n.r + 1], [n.x - n.r - 1, n.y + n.r + 1]];
  }
});

test('versus conduits: the hazards stay, the targets and enemies go, three are left out, and every seat is clear', async () => {
  const { CONDUITS, VERSUS_CONDUITS } = await import('../src/conduits.js');
  const { createGameState, versusSpawns, wellField } = await import('../src/gamestate.js');
  assert.deepEqual(CONDUITS.filter((c) => !c.versus).map((c) => c.title), ['Signal Box', 'Reliquary', 'Lamplighter']);
  assert.equal(VERSUS_CONDUITS.length, CONDUITS.length - 3);
  for (const def of VERSUS_CONDUITS) {
    for (const n of [2, 3]) {
      const seats = versusSpawns(def, n);
      assert.equal(seats.length, n, `${def.title} seats ${n}`);
      const g = createGameState(def, { pvp: n, spawns: seats });
      assert.equal(g.nodes.length, 0, `${def.title}: no nodes`);
      assert.equal(g.doors.length, 0, `${def.title}: no doors`);
      assert.equal(g.drones.length, 0, `${def.title}: no drones`);
      assert.equal(g.turrets.length, (def.turrets || []).length, `${def.title}: turrets stay`);
      assert.equal(g.emitters.length, (def.emitters || []).length, `${def.title}: emitters stay`);
      assert.equal(g.vents.length, (def.vents || []).length, `${def.title}: vents stay`);
      assert.equal(!!g.well, !!def.well, `${def.title}: the well stays`);
      assert.equal(g.panes.length, def.obstacles.filter((o) => o.glass).length, `${def.title}: glass stays`);
      assert.equal(g.objective.turrets, 0, 'nothing to clear');
      assert.equal(g.humans.length, n);
      assert.ok(g.maxSpeed === def.maxBallSpeed, 'still capped');
      for (const f of g.humans) {
        assert.ok(pointInPolygon(f.x, f.y, def.boundary), `${def.title}: seat ${f.slot} inside (${n} players)`);
        for (const poly of g.solidPolys) assert.ok(!pointInPolygon(f.x, f.y, poly), `${def.title}: seat ${f.slot} outside solids`);
        for (const w of g.walls) {
          const c = closestPointOnSegment(f.x, f.y, w.ax, w.ay, w.bx, w.by);
          assert.ok(Math.hypot(c.x - f.x, c.y - f.y) >= f.r + 8, `${def.title}: seat ${f.slot} clear of walls (${n} players)`);
        }
        for (const m of g.movers) if (m.kind === 'piston') for (let k = 0; k <= 24; k++) for (const sg of m.segmentsAt((k / 24) * m.period)) {
          const c = closestPointOnSegment(f.x, f.y, sg.ax, sg.ay, sg.bx, sg.by);
          assert.ok(Math.hypot(c.x - f.x, c.y - f.y) >= f.r + m.thick + 8, `${def.title}: seat ${f.slot} clear of the pistons`);
        }
        if (g.well) assert.equal(wellField(g.well, f.x, f.y), null, `${def.title}: seat ${f.slot} out of the well's reach`);
        for (const t of g.turrets) assert.ok(Math.hypot(t.x - f.x, t.y - f.y) > 150, `${def.title}: seat ${f.slot} away from the turrets`);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y) >= 300, `${def.title}: seats apart`);
    }
  }
  // A conduit with no boss and no seat list still seats everyone: the player's spot, then fair clear spots.
  const auto = versusSpawns(CONDUITS.find((c) => !c.versus), 3);
  assert.equal(auto.length, 3);
});

test('the bare serve: a ball is unplayed from the launch until a shield touches it, and The Absence phases like Umbra', async () => {
  const { createGameState, dronePhased } = await import('../src/gamestate.js');
  const b = new Ball(BALL.radius);
  b.launch(100, 300, 0, 400);
  assert.equal(b.played, false, 'fresh off the launch');
  // A wall does not play it.
  const walls = polygonEdges([[0, 0], [600, 0], [600, 600], [0, 600]]);
  for (let i = 0; i < 240 * 2; i++) advanceBall(b, walls, [], 1 / 240);
  assert.equal(b.played, false, 'walls do not count');
  // A shield does.
  const f = new Fighter({ x: 300, y: 300, angle: Math.PI, paddleBase: 36, paddleWidth: 116 });
  b.launch(200, 300, 0, 400);
  let hit = false;
  for (let i = 0; i < 240 && !hit; i++) advanceBall(b, walls, [f], 1 / 240, 1, { onPaddle: () => (hit = true) });
  assert.ok(hit && b.played, 'a shield touch plays it');
  b.launch(200, 300, 0, 400);
  assert.equal(b.played, false, 'and the next serve starts over');
  // The Absence: solid three seconds in five, like Umbra.
  const nullspace = LEVELS.find((l) => l.title === 'Nullspace');
  assert.deepEqual(nullspace.boss.phasing, { on: 3, off: 2 });
  const g = createGameState(nullspace);
  assert.equal(g.boss.phased, false);
  assert.equal(dronePhased(g.boss.phasing, 3.5), true);
  assert.equal(dronePhased(g.boss.phasing, 5.5), false);
  const umbra = (await import('../src/conduits.js')).CONDUITS.find((c) => c.well).drones[0];
  assert.deepEqual(umbra.phasing, nullspace.boss.phasing, 'the same clock as its draft');
});

test('frames: every frame spends the same cells, the standard one is the game as it was, and a tampered allocation is balanced back', async () => {
  const { SYSTEMS, TIERS, FRAME_CELLS, STANDARD, FRAMES, allFrames, frameById, frameStats, withinBudget, cellsSpent, isLegal, normalizeCells, MAX_HULL } = await import('../src/frames.js');
  const { PLAYER } = await import('../src/config.js');
  assert.equal(SYSTEMS.length, 4);
  for (const s of SYSTEMS) assert.equal(s.values.length, TIERS, `${s.key} has a value per tier`);
  // Nobody is richer than anyone else, and nothing is off the scale.
  for (const f of allFrames()) {
    assert.equal(cellsSpent(f.cells), FRAME_CELLS, `${f.name} spends the budget`);
    assert.ok(isLegal(f.cells), `${f.name} is legal`);
    for (const s of SYSTEMS) assert.ok(f.cells[s.key] >= 0 && f.cells[s.key] < TIERS, `${f.name}: ${s.key} in range`);
  }
  assert.equal(FRAMES.length, 3, 'three cut frames, plus the custom one');
  assert.equal(allFrames().length, 4, 'one per reading of the mark');
  // The standard frame is exactly the fighter the game had before frames.
  const std = frameStats(STANDARD);
  assert.equal(std.radius, PLAYER.radius);
  assert.equal(std.paddleWidth, PLAYER.paddleWidth);
  assert.equal(std.paddleBase, PLAYER.paddleOffset);
  assert.equal(std.moveSpeed, PLAYER.moveSpeed);
  assert.equal(std.turnSpeed, PLAYER.turnSpeed);
  assert.deepEqual(frameById('reflector').cells, STANDARD);
  // The trades run the way they are meant to: cells buy speed and span, and shrink the hull.
  const drive = SYSTEMS.find((s) => s.key === 'drive').values;
  const hull = SYSTEMS.find((s) => s.key === 'hull').values;
  for (let i = 1; i < TIERS; i++) {
    assert.ok(drive[i] > drive[i - 1], 'more cells, more speed');
    assert.ok(hull[i] < hull[i - 1], 'more cells, smaller hull');
  }
  assert.equal(MAX_HULL, hull[0]);
  // The shield keeps its gap from the body on every hull, so no frame has a hole between the two.
  for (let i = 0; i < TIERS; i++) {
    const st = frameStats({ ...STANDARD, hull: i, drive: 2, gyro: 2, span: 8 - 2 - 2 - i < 0 ? 0 : Math.min(TIERS - 1, 8 - 2 - 2 - i) });
    assert.equal(st.paddleBase - st.radius, PLAYER.paddleGap);
  }
  // An allocation that overspends (an old save, a hand-edited one, a guest's
  // claim over the network) is trimmed; one that underspends is left alone,
  // since spending less only costs the player who does it.
  assert.equal(cellsSpent(withinBudget({ drive: 4, gyro: 4, span: 4, hull: 4 })), FRAME_CELLS);
  assert.equal(cellsSpent(withinBudget({ drive: 99, gyro: -5, span: 9, hull: 9 })), FRAME_CELLS);
  assert.deepEqual(withinBudget({ drive: 0, gyro: 0, span: 0, hull: 0 }), { drive: 0, gyro: 0, span: 0, hull: 0 });
  assert.equal(cellsSpent(withinBudget({ drive: 1, gyro: 1, span: 1, hull: 1 })), 4, 'an underspent frame stays underspent');
  // Trimming takes from the richest system, so an overspent frame keeps its shape as far as it can.
  const trimmed = withinBudget({ drive: 4, gyro: 4, span: 0, hull: 0 });
  assert.equal(cellsSpent(trimmed), FRAME_CELLS);
  assert.deepEqual(trimmed, { drive: 4, gyro: 4, span: 0, hull: 0 });
  // What the panel shows is what the fighter gets: no silent top-up.
  const half = { drive: 1, gyro: 1, span: 1, hull: 1 };
  assert.equal(frameStats(half).moveSpeed, SYSTEMS[0].values[1]);
  assert.deepEqual(normalizeCells({}), STANDARD, 'a missing system takes the standard tier');
  assert.equal(isLegal({ drive: 4, gyro: 4, span: 4, hull: 4 }), false);
});

test('frames in play: every seat wears its own, the shape reaches the fighters, and the ball is still sealed in', async () => {
  const { createGameState } = await import('../src/gamestate.js');
  const { frameById, frameStats, STANDARD, allFrames } = await import('../src/frames.js');
  const def = LEVELS[0];
  // Single player: the frame reaches the fighter.
  for (const f of allFrames()) {
    const g = createGameState(def, { frames: { a: f.cells } });
    const st = frameStats(f.cells);
    assert.equal(g.player.r, st.radius, `${f.name} hull`);
    assert.equal(g.player.paddleWidth, st.paddleWidth, `${f.name} span`);
    assert.equal(g.player.moveSpeed, st.moveSpeed, `${f.name} drive`);
    assert.equal(g.player.turnSpeed, st.turnSpeed, `${f.name} gyro`);
    assert.deepEqual(g.frames.a, f.cells, 'the game remembers what it built');
    assert.equal(g.boss.r, def.boss.r, 'the boss is untouched');
  }
  // No frames given: the standard one, so every existing caller is unchanged.
  assert.deepEqual(createGameState(def).frames.a, STANDARD);
  // Versus: each seat its own, and co-op likewise.
  const arena = VERSUS_LEVELS[0];
  const pvp = createGameState(arena, { pvp: 3, frames: { a: frameById('deflector').cells, c: frameById('defector').cells } });
  assert.equal(pvp.humans[0].r, 28, 'the host wears the Deflector');
  assert.equal(pvp.humans[1].r, 19, 'the first guest the Defector');
  assert.equal(pvp.humans[2].r, 22, 'a seat that never said wears the standard frame');
  const coop = createGameState(def, { coop: 2, frames: { a: frameById('defector').cells, c: frameById('deflector').cells } });
  assert.equal(coop.player.paddleWidth, 92);
  assert.equal(coop.allies[0].paddleWidth, 140);
  assert.equal(coop.allies[1].paddleWidth, 116);
  // The biggest hull still fits every co-op spawn and every versus seat.
  const wall = frameById('deflector').cells;
  const allWall = { a: wall, c: wall, d: wall };
  const fits = (lvl, g) => {
    for (const f of g.humans) {
      assert.ok(pointInPolygon(f.x, f.y, lvl.boundary), `${lvl.title}: a Deflector fits inside`);
      for (const poly of g.solidPolys) assert.ok(!pointInPolygon(f.x, f.y, poly), `${lvl.title}: clear of solids`);
      for (const w of g.walls) {
        const c = closestPointOnSegment(f.x, f.y, w.ax, w.ay, w.bx, w.by);
        assert.ok(Math.hypot(c.x - f.x, c.y - f.y) >= f.r, `${lvl.title}: not inside a wall`);
      }
    }
  };
  for (const lvl of LEVELS) fits(lvl, createGameState(lvl, { coop: 2, frames: allWall }));
  for (const lvl of VERSUS_LEVELS.concat(LEVELS)) fits(lvl, createGameState(lvl, { pvp: 3, frames: allWall }));
});

test('foresight: one stat sets all three forecasts, the default is the old behaviour, and the ten bosses sharpen level by level', async () => {
  const { foresight, DEFAULT_FORESIGHT, predictReturn } = await import('../src/ai.js');
  // The three depths hang off the one number, and the default reproduces what every boss used before.
  assert.deepEqual(foresight({ foresight: 3 }), { threat: 3, read: 4, aim: 2 });
  assert.deepEqual(foresight({}), foresight({ foresight: DEFAULT_FORESIGHT }), 'no stat, the default depth');
  assert.equal(DEFAULT_FORESIGHT, 3);
  assert.deepEqual(foresight({ foresight: 1 }), { threat: 1, read: 2, aim: 1 }, 'aim never drops below one bounce');
  assert.deepEqual(foresight({ foresight: 0 }), { threat: 0, read: 1, aim: 1 });
  assert.deepEqual(foresight({ foresight: 5 }), { threat: 5, read: 6, aim: 4 });
  // Every campaign boss declares one, and it never falls as the levels go up.
  let prev = 0;
  for (const lvl of LEVELS) {
    const f = lvl.boss.foresight;
    assert.ok(Number.isInteger(f) && f >= 1, `level ${lvl.id} declares a foresight`);
    assert.ok(f >= prev, `level ${lvl.id} reads at least as far as level ${lvl.id - 1}`);
    prev = f;
  }
  assert.equal(LEVELS[0].boss.foresight, 1, 'the first boss reads one bounce');
  assert.ok(LEVELS[LEVELS.length - 1].boss.foresight > LEVELS[0].boss.foresight, 'the last reads further than the first');
  // It does what it says: a shallow read follows the ball through fewer banks than a deep one.
  const room = polygonEdges([[0, 0], [1600, 0], [1600, 900], [0, 900]]);
  const player = new Fighter({ x: 1400, y: 450, angle: Math.PI, paddleWidth: 116, paddleBase: 36, paddleThick: 6, r: 22 });
  player.paddleOffset = 36;
  // A ball sent up and away from the player: it has to bank three times
  // before it can reach the shield, so only a deep read ever sees the return.
  const opts = { swing: false, error: 0 };
  const seen = { t: 0, x: 300, y: 200, vx: 420 * Math.cos((120 * Math.PI) / 180), vy: 420 * Math.sin((120 * Math.PI) / 180) };
  const seen2 = { t: 0, x: 400, y: 450, vx: -420, vy: 0 };
  const read = (s, b) => predictReturn(s, 0, player, room, 11, { ...opts, bounces: b });
  assert.equal(read(seen, 1), null, 'one bounce is not far enough');
  assert.equal(read(seen, 2), null, 'nor two');
  assert.equal(read(seen, 3), null, 'nor three');
  assert.ok(read(seen, 4) && read(seen, 4).t > 0, 'four reaches the shield');
  assert.ok(read(seen, 6), 'and so does six');
  // A shallower case: straight away from the player, one bank short of a read.
  assert.equal(read(seen2, 1), null);
  assert.ok(read(seen2, 2), 'two bounces sees it come back');
  // The depth a boss reads at is the one its foresight gives it.
  assert.equal(foresight(LEVELS[0].boss).read, 2, 'the first boss reads two legs ahead');
  assert.ok(foresight(LEVELS[LEVELS.length - 1].boss).read >= 6, 'the last reads six');
});
