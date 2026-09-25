// Defector: enemies. How each way of moving moves, how they end, what they
// drop, and what touching one does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, box } from '../src/world.js';
import { Robot } from '../src/player.js';
import { Enemy, KINDS, stepEnemy } from '../src/enemies.js';
import { Game } from '../src/game.js';
import { Fx } from '../src/fx.js';
import { buildLevel } from '../src/build.js';
import { Charge } from '../src/blaster.js';
import { BLASTER } from '../src/config.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { sightLine, placeEnd } from '../src/wormholes.js';
import { wellsAccel } from '../../src/gamestate.js';

const DT = 1 / 240;
/** A floor from x 0 to 2000 with a ledge at 1400: beyond it, a drop. */
const ledge = () => createWorld({ width: 4000, height: 2000, top: -1000, solids: [{ pts: box(0, 1000, 1400, 1000) }, { pts: box(-100, 0, 100, 2000) }] });
const far = new Robot(3500, 960); // the robot, well out of the way
const run = (e, w, bot, secs) => {
  for (let i = 0; i < secs / DT; i++) stepEnemy(e, w, bot, DT, null);
};

test('the roster moves six ways: walking, running, flying straight, zig-zag, swooping and jumping', () => {
  const moves = new Set(Object.values(KINDS).map((k) => k.move));
  for (const m of ['walk', 'run', 'fly', 'zigzag', 'swoop', 'jump']) assert.ok(moves.has(m), m);
});

test('a walker turns round at a ledge rather than walking off it', () => {
  const w = ledge();
  const e = new Enemy({ kind: 'skitter', x: 1200, y: 1000 - 17, dir: 1 }, 0);
  run(e, w, far, 12);
  assert.ok(e.x < 1400 && e.y < 1000, 'still on the ledge');
});

test('a runner charges the robot when it sees it on its own level', () => {
  const w = ledge();
  const e = new Enemy({ kind: 'dasher', x: 400, y: 1000 - 19, dir: 1 }, 0);
  const bot = new Robot(900, 970);
  run(e, w, bot, 0.8);
  assert.ok(e.vx > KINDS.dasher.speed * 0.8, `running at ${e.vx.toFixed(0)}`);
});

test('a flier keeps to its line, and a zig-zagger to its patch', () => {
  const w = ledge();
  const f = new Enemy({ kind: 'drifter', x: 800, y: 600, range: 200 }, 0);
  const z = new Enemy({ kind: 'flitter', x: 800, y: 600, range: 200 }, 1);
  let fx0 = Infinity;
  let fx1 = -Infinity;
  let zy0 = Infinity;
  let zy1 = -Infinity;
  for (let i = 0; i < 240 * 10; i++) {
    stepEnemy(f, w, far, DT, null);
    stepEnemy(z, w, { x: 800, y: 660 }, DT, null);
    fx0 = Math.min(fx0, f.x);
    fx1 = Math.max(fx1, f.x);
    zy0 = Math.min(zy0, z.y);
    zy1 = Math.max(zy1, z.y);
  }
  assert.ok(fx1 - fx0 > 300 && fx1 - fx0 < 460 && Math.abs(f.y - 600) < 2, 'the flier ranged back and forth on its line');
  assert.ok(zy1 - zy0 > 60, 'the zig-zagger went up and down');
});

test('a swooper dives through where the robot stands and climbs back out', () => {
  const w = ledge();
  const e = new Enemy({ kind: 'swooper', x: 700, y: 700 }, 0);
  const bot = new Robot(800, 970);
  let low = e.y;
  let back = Infinity;
  for (let i = 0; i < 240 * 4; i++) {
    stepEnemy(e, w, bot, DT, null);
    low = Math.max(low, e.y);
    if (low > 900) back = Math.min(back, e.y);
  }
  assert.ok(low > 900, `it came down to ${low.toFixed(0)}`);
  assert.ok(back < 760, 'and climbed back out to its height');
});

test('a hopper jumps toward the robot', () => {
  const w = ledge();
  const e = new Enemy({ kind: 'hopper', x: 600, y: 1000 - 19 }, 0);
  const bot = new Robot(1000, 970);
  let high = e.y;
  for (let i = 0; i < 240 * 3; i++) {
    stepEnemy(e, w, bot, DT, null);
    high = Math.min(high, e.y);
  }
  assert.ok(high < 900, 'it left the ground');
  assert.ok(e.x > 650, 'toward the robot');
});

test('a defeated enemy bursts into particles that spread twice its size, and no further', () => {
  const fx = new Fx();
  const r = 24;
  fx.explode(0, 0, r, '#ffffff');
  let widest = 0;
  for (let i = 0; i < 240; i++) {
    fx.update(DT);
    for (const p of fx.parts) {
      const d = Math.hypot(p.x, p.y);
      assert.ok(d <= 2 * r + 1e-9, `a piece at ${d.toFixed(1)} px is beyond the cloud`);
      widest = Math.max(widest, d);
    }
  }
  assert.ok(widest > 1.8 * r, `the cloud reached ${widest.toFixed(1)} of ${2 * r} px: a diameter twice the enemy's`);
});

/** A game on a long flat floor, with one enemy placed on it. */
function withEnemy(spec) {
  const g = new Game(buildLevel({ id: 60, boss: 'gardener', theme: {}, sections: [['flat', { len: 40, deco: false }]] }), { shields: 5, rng: () => 0.3 });
  const e = new Enemy(spec, 99);
  g.enemies.push(e);
  g.bot.invuln = 0;
  return { g, e };
}

test('landing on a stompable enemy bounces the robot and hurts the enemy', () => {
  const { g, e } = withEnemy({ kind: 'skitter', x: 800, y: -17 });
  g.bot.spawn(800, -150);
  g.bot.invuln = 0;
  for (let i = 0; i < 240 && !e.dead; i++) g.step(DT, { mx: 0 });
  assert.ok(e.dead, 'stomped');
  assert.equal(g.pool, 5, 'without costing a shield');
  assert.ok(g.bot.vy < 0 || g.bot.y < -60, 'the robot bounced');
});

test('landing on a spiky one costs a shield', () => {
  const { g, e } = withEnemy({ kind: 'burr', x: 800, y: -18 });
  g.bot.spawn(800, -150);
  g.bot.invuln = 0;
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0 });
  assert.equal(g.pool, 4);
  assert.ok(!e.dead);
});

test('a shielded enemy turns a charge away; from behind it goes down', () => {
  const { g, e } = withEnemy({ kind: 'lancer', x: 900, y: -21, speed: 0 });
  e.awake = true;
  e.speed = 0;
  g.bot.spawn(500, -31);
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0, aim: 0 }); // the shield turns to face the robot
  g.bot.aim = 0;
  g.cool = 0;
  g.fire();
  for (let i = 0; i < 240 * 0.8; i++) g.step(DT, { mx: 0 });
  assert.equal(e.hp, e.maxHp, 'the shot from in front came off the shield');
  // From behind: the shield faces the robot, so a charge coming the other way meets the body.
  g.charges.length = 0;
  const hp = e.hp;
  g.charges.push(new Charge({ x: e.x + e.r + 12, y: e.y, vx: -BLASTER.speed, vy: 0, born: g.time }));
  for (let i = 0; i < 10; i++) g.step(DT, { mx: 0 });
  assert.equal(e.hp, hp - 1);
});

test('a drop makes one pickup for each player, and only that player can take it', () => {
  const g = new Game(buildLevel({ id: 60, boss: 'gardener', theme: {}, sections: [['flat', { len: 40, deco: false }]] }), { mode: 'coop', players: 2, shields: 5, rng: () => 0.3 });
  g.players[1].bot.spawn(1400, -31); // well away from where it lands
  g.drop('strong', 700, -100);
  const mine = g.pickups.filter((p) => p.owner === 0);
  const theirs = g.pickups.filter((p) => p.owner === 1);
  assert.equal(mine.length, 1);
  assert.equal(theirs.length, 1);
  g.bot.spawn(700, -31);
  for (let i = 0; i < 240 * 2; i++) g.step(DT, { mx: 0 });
  assert.equal(g.ammo.strong > 0, true, 'the robot took its own');
  assert.equal(g.pickups.filter((p) => p.owner === 1).length, 1, "the other player's is still there");
});

test('every black hole in a pit has moons: fliers that circle it deep in its pull, clear of its horizon, the walls and the stepping stone', () => {
  let pits = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const g = new Game(bp, { shields: Infinity });
    const pitSections = bp.sections.filter((sec) => sec.type === 'well');
    for (const hole of g.world.wells.filter((w) => w.pull > 0 && pitSections.some((sec) => w.x > sec.x0 && w.x < sec.x1))) {
      pits++;
      const moons = g.enemies.filter((e) => e.orbit && e.orbit.cx === hole.x && e.orbit.cy === hole.y);
      assert.ok(moons.length >= 1 && moons.length <= 2, `level ${L.id}: the hole at x ${Math.round(hole.x)} has ${moons.length} moons`);
      assert.ok(moons.filter((e) => e.k.shoot).length <= 1, 'at most one of them shoots');
      const stone = Math.min(...bp.oneWays.filter((o) => o.x0 < hole.x && o.x1 > hole.x && o.y < hole.y).map((o) => o.y));
      for (const e of moons) {
        let weakest = Infinity;
        for (let i = 0; i < 240 * e.orbit.period; i++) {
          stepEnemy(e, g.world, far, DT, null);
          assert.ok(!e.bumped && e.orbit, 'it keeps its orbit, touching nothing');
          assert.ok(Math.hypot(e.x - hole.x, e.y - hole.y) > hole.r + e.r + 20, 'clear of the horizon');
          assert.ok(e.y - e.r > stone + 10, 'under the stepping stone, where a jump across never meets it');
          weakest = Math.min(weakest, Math.hypot(...Object.values(wellsAccel(g.world.wells, e.x, e.y))));
        }
        assert.ok(weakest > 2000, `a charge anywhere on its orbit is pulled at ${Math.round(weakest)} px/s² or more`);
      }
    }
  }
  assert.ok(pits >= 10, `${pits} pits with black holes in the campaign`);
});

test('a moon that goes through a wormhole leaves its orbit for good', () => {
  const w = ledge();
  // One end on the wall its orbit runs into, the other in the floor far off.
  const a = placeEnd(w, sightLine(w, 200, 700, Math.PI), 0);
  const b = placeEnd(w, sightLine(w, 1000, 900, Math.PI / 2), 1);
  w.portals[0] = [a, b];
  const e = new Enemy({ kind: 'drifter', x: 440, y: 700, move: 'fly', orbit: { cx: 200, cy: 700, rx: 240, ry: 40, period: 4, a: 0, dir: 1 } }, 0);
  let warped = false;
  for (let i = 0; i < 240 * 4 && !warped; i++) {
    stepEnemy(e, w, far, DT, null);
    warped = e.warped;
  }
  assert.ok(warped, 'it went through');
  assert.equal(e.orbit, null, 'and left its orbit');
  const x = e.x;
  run(e, w, far, 1);
  assert.ok(Math.abs(e.x - x) < 400, 'it patrols where it came out, not dragged back');
});

test('a locked room left through a wormhole, with no end inside to get back by, opens its doors and starts over', () => {
  const bp = buildLevel({ id: 93, boss: 'gardener', theme: {}, sections: [['flat', { len: 8, deco: false }], ['ambush', { len: 22, roof: 8, waves: [[['skitter', 6], ['skitter', 16]], [['hopper', 10]]] }], ['flat', { len: 40, deco: false }]] });
  const g = new Game(bp, { shields: Infinity });
  const a = g.ambushes[0];
  const w = g.world;
  const floorY = a.floor;
  g.bot.spawn((a.x0 + a.x1) / 2, floorY - 31);
  g.step(DT, { mx: 0 });
  assert.equal(a.state, 'fight', 'walking in locks it');
  assert.ok(a.gates.every((gt) => gt.closed), 'doors shut');
  // One end in the room's floor, the other far outside: the robot goes through.
  const inRoom = placeEnd(w, sightLine(w, a.x0 + 200, floorY - 100, Math.PI / 2), 0);
  const outside = placeEnd(w, sightLine(w, a.x1 + 600, floorY - 100, Math.PI / 2), 1);
  w.portals[0] = [inRoom, outside];
  g.bot.spawn(a.x1 + 700, floorY - 31);
  g.bot.invuln = 1e9;
  g.step(DT, { mx: 0 });
  assert.equal(a.state, 'fight', 'with an end still inside, the way back is open, so it stays locked');
  g.closeEnd(0);
  g.step(DT, { mx: 0 });
  assert.equal(a.state, 'idle', 'with no way back, it starts over');
  assert.equal(g.enemies.filter((e) => e.room === a).length, 0, 'its wave is gone');
  assert.ok(a.gates.every((gt) => !gt.closed), 'its doors are open');
  g.bot.spawn((a.x0 + a.x1) / 2, floorY - 31);
  g.step(DT, { mx: 0 });
  assert.equal(a.state, 'fight', 'and it locks again from the first wave when the robot comes back in');
  assert.equal(a.wave, 0);
});
