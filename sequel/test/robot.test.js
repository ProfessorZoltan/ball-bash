// Defector: the robot's movement, against the numbers in MOVE (config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, box, stepWorld } from '../src/world.js';
import { Robot, stepRobot } from '../src/player.js';
import { Game } from '../src/game.js';
import { buildLevel } from '../src/build.js';
import { MOVE, TILE } from '../src/config.js';

const DT = 1 / 240;
const floorWorld = (extra = {}) => createWorld({ width: 6000, height: 1600, solids: [{ pts: box(0, 1000, 6000, 600) }, ...(extra.solids || [])], oneWays: extra.oneWays || [], movers: extra.movers || [], wells: extra.wells || [] });

/** Stand the robot on the floor of `w` at x, settled. */
function stand(w, x) {
  const b = new Robot(x, 960);
  for (let i = 0; i < 120; i++) stepRobot(b, { mx: 0 }, w, DT);
  return b;
}

/** Run up to speed, jump holding jump for `hold` seconds, and measure the jump. */
function jumpFrom(w, run, hold) {
  const b = stand(w, 200);
  for (let i = 0; i < 480; i++) stepRobot(b, { mx: 1, run }, w, DT);
  const x0 = b.x;
  const y0 = b.y;
  let top = b.y;
  let t = 0;
  let i = 0;
  do {
    stepRobot(b, { mx: 1, run, jump: t < hold, jumpPressed: i === 0 }, w, DT);
    top = Math.min(top, b.y);
    t += DT;
    i++;
  } while ((i < 5 || !b.onGround) && i < 2000);
  return { height: y0 - top, distance: b.x - x0, air: t };
}

test('a walking jump held all the way rises four and a half tiles', () => {
  const j = jumpFrom(floorWorld(), false, 10);
  assert.ok(Math.abs(j.height - 4.5 * TILE) < 6, `rose ${j.height.toFixed(1)} px`);
});

test('a running jump held all the way rises five and a half tiles and carries over eight', () => {
  const j = jumpFrom(floorWorld(), true, 10);
  assert.ok(Math.abs(j.height - 5.5 * TILE) < 6, `rose ${j.height.toFixed(1)} px`);
  assert.ok(j.distance > 8 * TILE, `carried ${j.distance.toFixed(0)} px`);
});

test('a tap of jump is a hop of under two tiles, and holding longer goes higher', () => {
  const tap = jumpFrom(floorWorld(), false, 0);
  const mid = jumpFrom(floorWorld(), false, 0.15);
  const full = jumpFrom(floorWorld(), false, 10);
  assert.ok(tap.height < 2 * TILE, `a tap rose ${tap.height.toFixed(1)} px`);
  assert.ok(tap.height < mid.height && mid.height < full.height);
});

test('running is faster than walking, and letting go on the ground stops the robot quickly', () => {
  const w = floorWorld();
  const b = stand(w, 200);
  for (let i = 0; i < 480; i++) stepRobot(b, { mx: 1 }, w, DT);
  assert.ok(Math.abs(b.vx - MOVE.walk) < 1);
  for (let i = 0; i < 480; i++) stepRobot(b, { mx: 1, run: true }, w, DT);
  assert.ok(Math.abs(b.vx - MOVE.run) < 1);
  for (let i = 0; i < 120; i++) stepRobot(b, { mx: 0 }, w, DT);
  assert.equal(b.vx, 0);
});

test('the air steers: reversing in mid-air turns a jump round', () => {
  const w = floorWorld();
  const b = stand(w, 1000);
  for (let i = 0; i < 240; i++) stepRobot(b, { mx: 1 }, w, DT);
  stepRobot(b, { mx: -1, jump: true, jumpPressed: true }, w, DT);
  for (let i = 0; i < 100; i++) stepRobot(b, { mx: -1, jump: true }, w, DT);
  assert.ok(b.vx < 0, 'it is moving back the way it came');
});

test('a jump pressed a moment after running off a ledge still counts', () => {
  const w = createWorld({ width: 3000, height: 1600, solids: [{ pts: box(0, 1000, 600, 600) }] });
  const b = new Robot(400, 960);
  for (let i = 0; i < 120; i++) stepRobot(b, { mx: 0 }, w, DT);
  let left = -1;
  for (let i = 0; i < 400; i++) {
    stepRobot(b, { mx: 1 }, w, DT);
    if (!b.onGround) {
      left = i;
      break;
    }
  }
  assert.ok(left > 0, 'it ran off the edge');
  for (let i = 0; i < 8; i++) stepRobot(b, { mx: 1 }, w, DT); // 1/30 s later
  stepRobot(b, { mx: 1, jump: true, jumpPressed: true }, w, DT);
  assert.ok(b.vy < -600, 'the late jump still leaves the ground');
});

test('the robot stands on the very lip of a ledge until its middle is past it', () => {
  const w = createWorld({ width: 3000, height: 1600, solids: [{ pts: box(0, 1000, 600, 600) }] });
  const b = new Robot(600 + 8, 960);
  for (let i = 0; i < 240; i++) stepRobot(b, { mx: 0 }, w, DT);
  assert.ok(b.onGround && b.x > 600, 'it stands with its middle just over the edge');
  const c = new Robot(600 + 20, 960);
  for (let i = 0; i < 240; i++) stepRobot(c, { mx: 0 }, w, DT);
  assert.ok(c.y > 1000, 'further out it falls');
});

test('a thin platform is a floor from above, and can be jumped up through and dropped through', () => {
  const w = floorWorld({ oneWays: [{ x0: 300, x1: 600, y: 900 }] });
  const b = stand(w, 450);
  assert.ok(b.y > 950, 'it starts on the floor below');
  stepRobot(b, { mx: 0, jump: true, jumpPressed: true }, w, DT);
  for (let i = 0; i < 360; i++) stepRobot(b, { mx: 0, jump: true }, w, DT);
  assert.ok(b.onGround && Math.abs(b.bottom - 900) < 2, 'it jumped up through and landed on top');
  for (let i = 0; i < 120; i++) stepRobot(b, { mx: 0, down: true }, w, DT);
  for (let i = 0; i < 240; i++) stepRobot(b, { mx: 0 }, w, DT);
  assert.ok(Math.abs(b.bottom - 1000) < 2, 'holding down dropped it back through to the floor');
});

test('walking up and down a slope keeps the robot on the ground', () => {
  const pts = [[0, 1000], [400, 1000], [800, 800], [1200, 800], [1600, 1000], [3000, 1000], [3000, 1600], [0, 1600]];
  const w = createWorld({ width: 3000, height: 1600, solids: [{ pts }] });
  const b = new Robot(100, 960);
  for (let i = 0; i < 120; i++) stepRobot(b, { mx: 0 }, w, DT);
  let airborne = 0;
  for (let i = 0; i < 240 * 8; i++) {
    stepRobot(b, { mx: 1 }, w, DT);
    if (b.x > 300 && b.x < 1800 && !b.onGround) airborne++;
  }
  assert.ok(b.x > 1800, 'it walked over the hill');
  assert.ok(airborne < 10, `it left the ground for ${airborne} steps`);
});

test('a moving platform carries whoever stands on it', () => {
  const w = floorWorld({ movers: [{ x: 300, y: 700, w: 160, h: 20, path: { type: 'line', dx: 600, dy: 0, period: 6 } }] });
  const b = new Robot(380, 640);
  for (let i = 0; i < 60; i++) {
    stepWorld(w, DT);
    stepRobot(b, { mx: 0 }, w, DT);
  }
  const x0 = b.x;
  for (let i = 0; i < 240 * 2; i++) {
    stepWorld(w, DT);
    stepRobot(b, { mx: 0 }, w, DT);
  }
  assert.ok(b.onGround && b.groundMover, 'it is standing on the platform');
  assert.ok(b.x - x0 > 150, `carried ${(b.x - x0).toFixed(0)} px`);
});

test('a spring throws the robot higher than any jump', () => {
  const bp = buildLevel({ id: 90, boss: 'gardener', theme: {}, sections: [['spring', { up: 7, run: 5, after: 4 }]] });
  const g = new Game(bp, { shields: 3 });
  const rec = bp.springs[0];
  g.bot.spawn(rec.x + rec.w / 2, rec.y - 40);
  let top = g.bot.y;
  for (let i = 0; i < 240; i++) {
    g.step(DT, { mx: 0, jump: true });
    top = Math.min(top, g.bot.y);
  }
  assert.ok(rec.y - top > 6 * TILE, `rose ${(rec.y - top).toFixed(0)} px`);
});

test('a fall into a pit costs a shield and puts the robot back on the ground it last stood on', () => {
  const bp = buildLevel({ id: 91, boss: 'gardener', theme: {}, sections: [['gap', { w: 6, run: 3 }]] });
  const g = new Game(bp, { shields: 3 });
  for (let i = 0; i < 240 * 1.5; i++) g.step(DT, { mx: 0 });
  const safe = { ...g.bot.safe };
  for (let i = 0; i < 240 * 6 && g.pool === 3; i++) g.step(DT, { mx: 1 });
  assert.equal(g.pool, 2);
  assert.ok(g.bot.invuln > 0, 'it flickers after');
  assert.ok(g.bot.x <= safe.x + 400 && g.bot.y < bp.pits[0].y, 'it is back up on solid ground');
});

test('a crusher that pins the robot to the floor costs a shield', () => {
  const bp = buildLevel({ id: 92, boss: 'gardener', theme: {}, sections: [['crushers', { n: 1, space: 5, period: 2, roof: 5 }]] });
  const g = new Game(bp, { shields: 3 });
  const m = bp.movers[0];
  g.bot.spawn(m.x + m.w / 2, -40);
  g.bot.invuln = 0;
  for (let i = 0; i < 240 * 3; i++) g.step(DT, { mx: 0 });
  assert.ok(g.pool < 3, 'the slab came down on it');
});
