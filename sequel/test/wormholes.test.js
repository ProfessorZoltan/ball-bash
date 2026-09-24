// Defector: wormholes. Where an end lands, what goes through (the robot,
// its charges, enemies and their shots), the folded rule, and the places a
// wormhole is the only way on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, box, stepWorld } from '../src/world.js';
import { sightLine, placeEnd, refreshEnds, PORTAL } from '../src/wormholes.js';
import { Robot, stepRobot } from '../src/player.js';
import { Charge, stepCharge } from '../src/blaster.js';
import { Enemy, stepEnemy } from '../src/enemies.js';
import { Game } from '../src/game.js';
import { buildLevel } from '../src/build.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { BLASTER } from '../src/config.js';
import { reachability } from '../tools/reach.mjs';
import { solve } from '../tools/solve.mjs';

const DT = 1 / 240;

/** A long floor with a tall wall at its far end, and a second wall far off to the left. */
function hall(extra = {}) {
  return createWorld({
    width: 9000,
    height: 2000,
    top: -2000,
    solids: [{ pts: box(0, 1000, 9000, 1000) }, { pts: box(8000, 0, 400, 1000) }, { pts: box(0, 0, 300, 1000) }, ...(extra.solids || [])],
    oneWays: extra.oneWays || [],
    movers: extra.movers || [],
    wells: extra.wells || [],
    crates: extra.crates || [],
  });
}

/** Open a pair: `a` and `b` are [x, y, angle] to look from. */
function pair(w, a, b) {
  const p = placeEnd(w, sightLine(w, a[0], a[1], a[2]), 0);
  const q = placeEnd(w, sightLine(w, b[0], b[1], b[2]), 1);
  assert.ok(p && q, 'both ends found a surface');
  w.portals[0] = [p, q];
  return [p, q];
}

test('an end lands where the line of sight first meets a surface, however far away', () => {
  const w = hall();
  const p = placeEnd(w, sightLine(w, 400, 900, 0), 0);
  assert.ok(p, 'it found the far wall');
  assert.ok(Math.abs(p.cx - 8000) < 1 && p.nx === -1, 'it sits on the wall 7600 px away, facing back');
  assert.ok(p.cy <= 1000 - PORTAL.halfWidth + 0.5, 'slid up so the whole mouth lies on the wall');
});

test('the line of sight bends round a black hole the way a charge does', () => {
  const straight = sightLine(hall(), 400, 700, 0);
  const bent = sightLine(hall({ wells: [{ x: 2000, y: 560, r: 20, range: 600, pull: 300000 }] }), 400, 700, 0);
  const endS = straight.pts[straight.pts.length - 1];
  const endB = bent.pts[bent.pts.length - 1];
  assert.ok(Math.hypot(endS[0] - endB[0], endS[1] - endB[1]) > 50, 'the bent line ends somewhere else');
});

test('an end will not sit on a thin platform, a crate, or on top of its twin', () => {
  const w = hall({ oneWays: [{ x0: 900, x1: 1300, y: 800 }], crates: [{ x: 2000, y: 850, w: 150, h: 150 }] });
  const down = placeEnd(w, sightLine(w, 1100, 600, Math.PI / 2), 0);
  assert.ok(down && Math.abs(down.cy - 1000) < 1, 'the line goes through the thin platform to the floor below');
  const s = sightLine(w, 1500, 930, 0);
  assert.ok(s.hit && s.hit.seg.crate, 'the line meets the crate');
  assert.equal(placeEnd(w, s, 0), null, 'and a crate takes no wormhole');
  w.portals[0][0] = placeEnd(w, sightLine(w, 4000, 900, Math.PI / 2), 0);
  assert.equal(placeEnd(w, sightLine(w, 4010, 900, Math.PI / 2), 1), null, 'nor does the floor under the other end');
});

test('the robot falls into a floor end and comes out of a wall end, moving out of it', () => {
  const w = hall();
  pair(w, [1000, 900, Math.PI / 2], [1000, 900, 0]);
  const b = new Robot(1000, 960);
  let warped = null;
  for (let i = 0; i < 240 * 2 && !warped; i++) stepRobot(b, { mx: 0 }, w, DT, { warp: (from, to) => (warped = { from, to }) });
  assert.ok(warped, 'it went through');
  assert.ok(b.x < 8000 && b.x > 7800, 'it came out at the far wall');
  assert.ok(b.vx < -200, 'moving out of the wall, at least WORM.minExit');
});

test('an end on a moving platform rides with it, and goes when a blinking platform blinks out', () => {
  const w = hall({ movers: [{ x: 1000, y: 600, w: 300, h: 20, path: { type: 'line', dx: 400, dy: 0, period: 4 } }, { x: 2500, y: 600, w: 300, h: 20, path: { type: 'phase', on: 1, off: 1 } }] });
  const p = placeEnd(w, sightLine(w, 1150, 900, -Math.PI / 2), 0);
  assert.ok(p && p.host.kind === 'mover', 'on the underside of the platform');
  const x0 = p.cx;
  w.portals[0][0] = p;
  const q = placeEnd(w, sightLine(w, 2650, 900, -Math.PI / 2), 1);
  w.portals[0][1] = q;
  let gone = [];
  for (let i = 0; i < 300; i++) {
    stepWorld(w, DT);
    gone = gone.concat(refreshEnds(w));
  }
  assert.ok(Math.abs(p.cx - x0) > 50, 'it moved with the platform');
  assert.ok(gone.includes(q), 'the blinking platform took its end with it');
});

test('a charge goes through a wormhole, and comes out counted as warped', () => {
  const w = hall();
  pair(w, [1000, 900, Math.PI / 2], [1000, 900, 0]);
  const c = new Charge({ x: 1000, y: 800, vx: 0, vy: BLASTER.speed, born: 0 });
  let t = 0;
  while (!c.warps && stepCharge(c, w, DT, t, {}) && t < 1) t += DT;
  assert.equal(c.warps, 1);
  assert.ok(c.x > 7800 && c.vx < 0, 'out of the far wall, heading back');
});

test('an enemy walks into a floor wormhole and comes out of the other end', () => {
  const w = hall();
  pair(w, [1200, 900, Math.PI / 2], [1200, 900, 0]);
  const e = new Enemy({ kind: 'skitter', x: 1000, y: 1000 - 17, dir: 1 }, 0);
  const bot = new Robot(4000, 960);
  let warped = false;
  for (let i = 0; i < 240 * 6 && !warped; i++) {
    stepEnemy(e, w, bot, DT, null);
    warped = e.warped;
  }
  assert.ok(warped, 'it went through');
  assert.ok(e.x > 7700, 'and came out at the far wall');
});

test('a flying enemy goes through a wall wormhole in its path', () => {
  const w = hall();
  pair(w, [1000, 900, Math.PI], [1000, 900, 0]);
  const e = new Enemy({ kind: 'drifter', x: 800, y: 900, dir: -1, range: 1000 }, 0);
  const bot = new Robot(4000, 960);
  let warped = false;
  for (let i = 0; i < 240 * 10 && !warped; i++) {
    stepEnemy(e, w, bot, DT, null);
    warped = e.warped;
  }
  assert.ok(warped && e.x > 7500, 'out of the far end');
});

test('an enemy\'s shot goes through the robot\'s wormholes too', () => {
  const g = new Game(buildLevel({ id: 70, boss: 'gardener', theme: {}, sections: [['flat', { len: 60, deco: false }]] }), { shields: 5 });
  const w = g.world;
  pair(w, [800, -40, Math.PI], [800, -40, 0]);
  const c = g.shot(300, -60, Math.PI, 300, { bounce: false });
  for (let i = 0; i < 240 * 2 && !c.warps; i++) g.step(DT, { mx: 0 });
  assert.equal(c.warps, 1, 'the shot came through');
});

test('a folded enemy is touched only by a charge that has been through a wormhole', () => {
  const g = new Game(buildLevel({ id: 71, boss: 'gardener', theme: {}, sections: [['flat', { len: 40, deco: false }]] }), { shields: 5 });
  const e = new Enemy({ kind: 'wraith', x: 900, y: -200 }, 0);
  e.awake = true;
  g.enemies.push(e);
  const plain = new Charge({ x: 885, y: -200, vx: BLASTER.speed, vy: 0, born: g.time });
  g.charges.push(plain);
  g.stepCharges(DT);
  assert.equal(e.hp, e.maxHp, 'an ordinary charge passes through');
  assert.ok(g.charges.includes(plain), 'and flies on');
  const folded = new Charge({ x: 885, y: -200, vx: BLASTER.speed, vy: 0, born: g.time });
  folded.warps = 1;
  g.charges.push(folded);
  g.stepCharges(DT);
  assert.equal(e.hp, e.maxHp - 1, 'a charge that has been through a wormhole hits it');
});

test('every bulkhead and chasm in every level is solved by wormholes, and by nothing else', () => {
  let solved = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const link of bp.portalLinks) {
      const r = solve(new Game(bp, { shields: Infinity }), link);
      assert.ok(r.ok, `level ${L.id}: the ${link.kind} at x ${Math.round(link.from.x)} was not solved (${r.reason || `robot at ${Math.round(r.x)}`})`);
      solved++;
    }
    if (bp.portalLinks.length) {
      const r = reachability(bp, { links: false });
      assert.ok(!r.ok, `level ${L.id} can be crossed without a wormhole`);
      assert.ok(r.furthest < bp.portalLinks[0].to.x, `level ${L.id}: its first puzzle can be walked round`);
    }
  }
  assert.ok(solved >= 10, `${solved} puzzles in the game`);
});
