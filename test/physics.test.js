import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect, circleVsCapsule, polygonEdges, pointInPolygon, predictPath, raycastSegments, closestPointOnSegment } from '../src/physics.js';
import { Ball, Fighter, Boss, Spinner, Piston, Orbiter, Pulser, createMover } from '../src/entities.js';
import { IceTrail } from '../src/ice.js';
import { advanceBall, separateFightersFromBall } from '../src/sim.js';
import { LEVELS, obstaclePoly } from '../src/levels.js';
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
  assert.deepEqual(pvp.fighters.map((f) => [f.slot, f.team]), [['a', 'a'], ['b', 'b']]);
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
