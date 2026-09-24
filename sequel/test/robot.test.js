// Defector: the robot's movement, against the numbers in MOVE (config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, box, stepWorld } from '../src/world.js';
import { Robot, stepRobot } from '../src/player.js';
import { Game } from '../src/game.js';
import { buildLevel } from '../src/build.js';
import { MOVE, TILE } from '../src/config.js';
import { Enemy } from '../src/enemies.js';
import { Charge } from '../src/blaster.js';

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

test('a fall after standing on a frozen enemy over a pit puts the robot back on solid ground, never over the pit', () => {
  const bp = buildLevel({ id: 94, boss: 'gardener', theme: {}, sections: [['flat', { len: 8, deco: false }], ['gap', { w: 8, run: 3, land: 6 }], ['flat', { len: 8, deco: false }]] });
  const g = new Game(bp, { shields: 5 });
  const pit = bp.pits[0];
  // A drifter frozen just off the lip, its ice level with the floor: a step out over the pit.
  const e = new Enemy({ kind: 'drifter', x: pit.x0 + 22, y: 22 }, 0);
  e.awake = true;
  g.enemies.push(e);
  g.damageEnemy(e, new Charge({ x: 0, y: 0, vx: 0, vy: 0, freeze: true }));
  g.bot.spawn(pit.x0 - 60, -31);
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0 });
  for (let i = 0; i < 240 && g.bot.x < e.x; i++) g.step(DT, { mx: 0.5 });
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0 });
  assert.ok(g.bot.onGround && g.bot.ground.ice && g.bot.x > pit.x0, 'standing on the ice, out over the pit');
  // Off the far side of the ice, into the pit.
  const pool = g.pool;
  for (let i = 0; i < 240 * 4 && g.pool === pool; i++) g.step(DT, { mx: 1 });
  assert.equal(g.pool, pool - 1, 'the fall cost a shield');
  assert.ok(g.bot.x < pit.x0, `put back on the lip at x ${Math.round(g.bot.x)}, not on the ice over the pit`);
  // A fall with no firm ground left under the last safe spot at all goes back to the checkpoint.
  g.bot.spawn((pit.x0 + pit.x1) / 2, -31); // out over the pit: a spawn records where it is
  g.bot.invuln = 0;
  for (let i = 0; i < 240 * 4 && g.pool === pool - 1; i++) g.step(DT, { mx: 0 });
  assert.equal(g.pool, pool - 2);
  assert.ok(g.bot.x < pit.x0 - g.bot.r || g.bot.x > pit.x1 + g.bot.r, `put back at x ${Math.round(g.bot.x)}, not over the pit`);
  for (let i = 0; i < 240 * 2; i++) g.step(DT, { mx: 0 });
  assert.ok(g.bot.onGround && g.pool === pool - 2, 'and it stands there, no loop');
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

/** A pit with a black hole in it, as the campaign lays them, and the lip it is jumped from. */
function holePit(pull, wells = true) {
  const bp = buildLevel({ id: 91, boss: 'gardener', theme: {}, sections: [['flat', { len: 10, deco: false }], ['well', { w: 7, depth: 2.5, range: 9, pull }], ['flat', { len: 12, deco: false }]] });
  const hole = bp.wells[0];
  const floorY = hole.y - 2.5 * TILE;
  return { w: createWorld({ ...bp, wells: wells ? bp.wells : [] }), lip: hole.x - 3.5 * TILE, far: hole.x + 3.5 * TILE, floorY };
}

test('a black hole in a pit drags a running leap across it down by a quarter, and more', () => {
  const leap = (p) => {
    const b = new Robot(p.lip - 250, p.floorY - 31);
    let jumped = false;
    let top = b.y;
    for (let i = 0; i < 240 * 2; i++) {
      const go = !jumped && b.x > p.lip - 12;
      stepRobot(b, { mx: 1, run: true, jump: go || (jumped && b.vy < 0), jumpPressed: go }, p.w, DT);
      if (go) jumped = true;
      if (jumped) top = Math.min(top, b.y);
    }
    return p.floorY - 31 - top;
  };
  const free = leap(holePit(330000, false));
  const pulled = leap(holePit(330000));
  assert.ok(pulled < free * 0.75, `a leap of ${free.toFixed(0)} px rises only ${pulled.toFixed(0)} over the easiest pit`);
});

test('a pit\'s black hole never drags a robot standing at its lip, and it can always walk away', () => {
  const p = holePit(450000); // the hardest pit in the campaign
  const b = new Robot(p.far + 16, p.floorY - 31);
  for (let i = 0; i < 240 * 2; i++) stepRobot(b, { mx: 0 }, p.w, DT);
  assert.ok(Math.abs(b.x - (p.far + 16)) < 1 && b.onGround, 'standing still, it stays put');
  let t = 0;
  for (; t < 3 && b.x < p.far + 16 + 3 * TILE; t += DT) stepRobot(b, { mx: 1 }, p.w, DT);
  assert.ok(t < 1.3, `three tiles clear of the lip in ${t.toFixed(2)} s, straining against the pull`);
});

test('a laser gate is lit for its time in each period, warns before it lights, and costs a shield to touch while lit', () => {
  const bp = buildLevel({ id: 92, boss: 'gardener', theme: {}, sections: [['flat', { len: 6, deco: false }], ['laser', { len: 10, n: 1, period: 3, on: 1.2, roof: 5 }], ['flat', { len: 10, deco: false }]] });
  const g = new Game(bp, { shields: 5 });
  const l = g.world.lasers[0];
  let lit = 0;
  let warned = 0;
  for (let i = 0; i < 240 * 3; i++) {
    stepWorld(g.world, DT);
    if (l.on) lit++;
    if (l.warn) warned++;
  }
  assert.ok(Math.abs(lit / 240 - 1.2) < 0.02, `lit ${(lit / 240).toFixed(2)} s of each 3`);
  assert.ok(Math.abs(warned / 240 - 0.6) < 0.02, 'with 0.6 s of warning first');
  // Stand in it: when it lights, a shield goes.
  g.bot.spawn(l.x, l.y1 - 31);
  const pool = g.pool;
  for (let i = 0; i < 240 * 3 && g.pool === pool; i++) g.step(DT, { mx: 0 });
  assert.equal(g.pool, pool - 1, 'standing in the gate cost a shield');
});
