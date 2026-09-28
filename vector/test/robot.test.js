// The robot's body in three dimensions: it stands, walks, jumps as far as the
// levels ask and no further than MOVE allows, climbs stairs and ramps, and
// goes through wormholes the way Defector's does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Robot, stepRobot, standAt } from '../src/player.js';
import { PHYSICS_DT, MOVE, JUMP, WORM } from '../src/config.js';
import { placeEnd } from '../src/wormholes.js';

const dt = PHYSICS_DT;

function flat(size = 200) {
  const w = new World();
  w.box([-size, -1, -size], [size, 0, size], { mat: 'floor' });
  w.floorY = 0;
  return w;
}

function run(bot, w, it, seconds, ends = [], each) {
  const n = Math.round(seconds / dt);
  const all = [];
  for (let i = 0; i < n; i++) {
    const ev = stepRobot(bot, typeof it === 'function' ? it(i * dt, bot) : it, w, dt, ends);
    all.push(...ev);
    if (each) each(bot, i * dt);
  }
  return all;
}

test('the robot stands on the floor and settles there', () => {
  const w = flat();
  const bot = new Robot([0, 3, 0]);
  run(bot, w, {}, 1.5);
  assert.ok(bot.onGround);
  assert.ok(Math.abs(bot.feet) < 0.02, `feet at ${bot.feet}`);
});

test('a held jump rises about 2.2 m walking and 2.7 m at a run, and a tap much less', () => {
  for (const [runIt, want] of [[false, 2.2], [true, 2.7]]) {
    const w = flat();
    const bot = new Robot(standAt(0, 0, 0));
    run(bot, w, { mz: 1, run: runIt }, 1.5);
    let peak = 0;
    run(bot, w, (t) => ({ mz: 1, run: runIt, jump: true, jumpPress: t === 0 }), 1.5, [], (b) => (peak = Math.max(peak, b.feet)));
    assert.ok(Math.abs(peak - want) < 0.12, `peak ${peak.toFixed(2)} for want ${want}`);
  }
  const w = flat();
  const bot = new Robot(standAt(0, 0, 0));
  run(bot, w, {}, 0.5);
  let peak = 0;
  run(bot, w, (t) => ({ jump: t < 0.03, jumpPress: t === 0 }), 1.5, [], (b) => (peak = Math.max(peak, b.feet)));
  assert.ok(peak < 1.2, `a tap rose ${peak.toFixed(2)}`);
});

test('a running jump carries well past what a level asks, and a walking one past its own gap', () => {
  for (const [runIt, need] of [[false, JUMP.walkGap + 0.8], [true, JUMP.runGap + 0.8]]) {
    const w = flat();
    const bot = new Robot(standAt(0, 0, 0));
    run(bot, w, { mz: 1, run: runIt }, 1.5);
    const z0 = bot.pos[2];
    let landed = null;
    run(bot, w, (t) => ({ mz: 1, run: runIt, jump: true, jumpPress: t === 0 }), 2, [], (b, t) => {
      if (landed === null && t > 0.1 && b.onGround) landed = b.pos[2] - z0;
    });
    assert.ok(landed > need, `${runIt ? 'run' : 'walk'} jump carried ${landed && landed.toFixed(2)}, need ${need}`);
  }
});

test('the robot walks up a stair and not up a wall', () => {
  const w = flat();
  w.box([-2, 0, 3], [2, 0.4, 20], { mat: 'floor' });
  w.box([-2, 0, 25], [2, 0.8, 30], { mat: 'floor' });
  const bot = new Robot(standAt(0, 0, 0));
  run(bot, w, { mz: 1 }, 2.5);
  assert.ok(bot.feet > 0.35 && bot.pos[2] > 10, `on the stair: feet ${bot.feet.toFixed(2)} z ${bot.pos[2].toFixed(1)}`);
  run(bot, w, { mz: 1 }, 3);
  assert.ok(bot.pos[2] < 25, `walked into the wall at z ${bot.pos[2].toFixed(2)}`);
});

test('the robot walks up a ramp and stands still on it without sliding', () => {
  const w = flat();
  w.ramp([-3, 0, 4], [3, 3, 12], 'z', 1, { mat: 'floor' });
  w.box([-3, 0, 12], [3, 3, 20], { mat: 'floor' });
  const bot = new Robot(standAt(0, 0, 0));
  run(bot, w, { mz: 1 }, 3);
  assert.ok(bot.feet > 2.9, `up the ramp: feet ${bot.feet.toFixed(2)}`);
  const bot2 = new Robot(standAt(0, 1.6, 8.2));
  run(bot2, w, {}, 2);
  const z = bot2.pos[2];
  run(bot2, w, {}, 2);
  assert.ok(Math.abs(bot2.pos[2] - z) < 0.01, `slid ${bot2.pos[2] - z}`);
});

test('a platform carries whoever stands on it', () => {
  const w = flat();
  const p = w.box([-1.5, 2, -1.5], [1.5, 2.5, 1.5], { mat: 'floor', move: { to: [10, 0, 0], period: 6 } });
  const bot = new Robot(standAt(0, 2.5, 0));
  for (let i = 0; i < 360; i++) {
    w.step(dt);
    stepRobot(bot, {}, w, dt);
  }
  assert.ok(bot.onGround && bot.ground === p, 'still on it');
  assert.ok(Math.abs(bot.pos[0] - (p.min[0] + 1.5)) < 0.3, `kept its place: ${bot.pos[0].toFixed(2)} vs ${(p.min[0] + 1.5).toFixed(2)}`);
});

function endOn(w, eye, dir, look = dir) {
  const h = w.raycast(eye, dir, 100);
  return placeEnd(w, h, look).end;
}

test('walking into a wall end carries the robot out of the twin, momentum turned', () => {
  const w = flat();
  w.box([-10, 0, 10], [10, 6, 11], { mat: 'wall' }); // ahead
  w.box([-30, 0, -10], [-29, 6, 10], { mat: 'wall' }); // far to the left (+x is left looking down +z)
  const A = endOn(w, [0, 1.5, 0], [0, 0, 1]);
  const B = endOn(w, [-20, 1.5, 0], [-1, 0, 0]);
  assert.ok(A && B, 'both ends placed');
  A.twin = B;
  B.twin = A;
  assert.ok(Math.abs(A.c[1] - WORM.b) < 1e-6, 'the mouth rests on the floor');
  const bot = new Robot(standAt(0, 0, 5));
  let warped = null;
  run(bot, w, { mz: 1 }, 3, [A, B], (b) => {
    if (!warped && b.pos[0] > -29 && b.pos[0] < -25 && b.pos[2] < 5) warped = [...b.pos];
  });
  assert.ok(warped, 'came out by the far wall');
  assert.ok(bot.pos[0] > -29 && Math.abs(bot.pos[2]) < 2, `walking on out of it: x ${bot.pos[0].toFixed(2)} z ${bot.pos[2].toFixed(2)}`);
  assert.ok(bot.vel[0] > 3, 'heading away from the far wall');
});

test('falling into a floor end throws the robot out of a wall end', () => {
  const w = flat();
  w.box([-30, 0, -10], [-29, 8, 10], { mat: 'wall' });
  const A = endOn(w, [0, 1.5, 0], [0, -1, 0.001], [0, 0, 1]);
  const B = endOn(w, [-20, 3, 0], [-1, 0, 0]);
  A.twin = B;
  B.twin = A;
  const bot = new Robot(standAt(0, 6, 0));
  let out = false;
  run(bot, w, {}, 2, [A, B], (b) => {
    if (b.pos[0] > -29 && b.pos[0] < -24) out = true;
  });
  assert.ok(out, 'came out of the wall');
  assert.ok(bot.pos[0] > -27, `thrown clear of the wall: x ${bot.pos[0].toFixed(2)}`);
});

test('a jump never reaches past what MOVE promises', () => {
  const w = flat();
  const bot = new Robot(standAt(0, 0, 0));
  run(bot, w, { mz: 1, run: true }, 1.5);
  let peak = 0;
  run(bot, w, (t) => ({ mz: 1, run: true, jump: true, jumpPress: t === 0 }), 2, [], (b) => (peak = Math.max(peak, b.feet)));
  const vy = MOVE.runJump;
  assert.ok(peak <= (vy * vy) / (2 * MOVE.gUp) + 0.05);
});

test('walking off a floor level with the top of a ramp, the robot goes on down it rather than catching on its edge', () => {
  for (const dir of [1, -1]) {
    const W = new World();
    W.box([-30, -2, -30], [30, 0, 30], {});
    if (dir > 0) {
      W.box([13, 0, 0], [22, 2.4, 6], {});
      W.ramp([5, 0, 0], [13, 2.4, 6], 'x', 1, {});
    } else {
      W.box([-22, 0, 0], [-13, 2.4, 6], {});
      W.ramp([-13, 0, 0], [-5, 2.4, 6], 'x', -1, {});
    }
    const b = new Robot(standAt(dir * 17, 2.4, 3), dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (let t = 0; t < 3 && Math.abs(b.pos[0]) > 6; t += 1 / 120) stepRobot(b, { mz: 1 }, W, 1 / 120, []);
    assert.ok(Math.abs(b.pos[0]) <= 6, `down the ramp to its foot (at x = ${b.pos[0].toFixed(2)})`);
    assert.ok(b.onGround);
  }
});
