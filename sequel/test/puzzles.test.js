// Defector: switches and their doors, armoured glass, the puzzles built from
// them, the towers and shafts, and the long blinking runs. Every puzzle in
// every level is solved in the real game in wormholes.test.js; these hold
// each piece to what it claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/build.js';
import { createWorld, box, segmentsNear } from '../src/world.js';
import { sightLine, placeEnd } from '../src/wormholes.js';
import { Robot, stepRobot } from '../src/player.js';
import { Charge, stepCharge } from '../src/blaster.js';
import { Game } from '../src/game.js';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { BLASTER, ROBOT } from '../src/config.js';
import { raycastSegments } from '../../src/physics.js';
import { solve, shotHits } from '../tools/solve.mjs';
import { crossTimed } from '../tools/timed.mjs';
import { reachability } from '../tools/reach.mjs';

const DT = 1 / 240;
const piece = (id, ...sections) => buildLevel({ id, boss: 'gardener', theme: {}, sections: [['flat', { len: 6, deco: false }], ...sections, ['flat', { len: 10, deco: false }]] });

test('a charge of yours flips a switch and its door opens; an enemy\'s shot does not', () => {
  const g = new Game(piece(110, ['switchdoor', { stand: 8 }]), { shields: 5 });
  const sw = g.world.switches[0];
  const door = g.world.doors[0];
  assert.ok(door.closed && !sw.on, 'shut to begin with');
  const theirs = g.shot(sw.x - 200, sw.y, 0, 300, { bounce: false });
  for (let i = 0; i < 240 && g.shots.includes(theirs); i++) g.step(DT, { mx: 0 });
  assert.ok(!sw.on && door.closed, 'an enemy shot is no key');
  g.charges.push(new Charge({ x: sw.x - 150, y: sw.y, vx: BLASTER.speed, vy: 0, born: g.time }));
  for (let i = 0; i < 60 && !sw.on; i++) g.step(DT, { mx: 0 });
  assert.ok(sw.on && !door.closed, 'yours is');
  assert.ok(g.events.some((e) => e.s === 'switch'));
});

test('a switch off screen takes no notice of a charge: a stray shot never opens a door far ahead', () => {
  // Level 1: shooting level at the skitters, a charge can run on down the corridor into the switch.
  const bp = level(1);
  const start = () => {
    const g = new Game(bp, { shields: Infinity });
    for (const e of g.enemies) e.dead = true;
    g.bot.spawn(2640, -31);
    for (let i = 0; i < 30; i++) g.step(DT, { mx: 0 });
    return g;
  };
  const g = start();
  const sw = g.world.switches[0];
  assert.ok(sw.x - g.bot.x > 1500, 'the switch is well off screen');
  let aim = null;
  for (let a = -0.2; a < 0.2 && aim == null; a += 0.005) if (shotHits(g, a, sw)) aim = a;
  assert.ok(aim != null, 'a shot from here can reach it');
  g.step(DT, { mx: 0, aim, fire: true });
  for (let i = 0; i < 240 * 3.2; i++) g.step(DT, { mx: 0, aim });
  assert.ok(!sw.on && g.world.doors[0].closed, 'and it goes by untouched');
  // The same shot with the switch on screen (the camera framing it) flips it.
  const h = start();
  h.view = { x: sw.x, y: sw.y, hw: 640, hh: 360 };
  h.step(DT, { mx: 0, aim, fire: true });
  for (let i = 0; i < 240 * 3.2; i++) h.step(DT, { mx: 0, aim });
  assert.ok(h.world.switches[0].on && !h.world.doors[0].closed, 'on screen, it flips');
});

test('a timed switch shuts its door again when it runs out, but never on the robot', () => {
  const g = new Game(piece(111, ['switchdoor', { stand: 8, hold: 2 }]), { shields: 5 });
  const sw = g.world.switches[0];
  const door = g.world.doors[0];
  g.flipSwitch(sw);
  g.bot.spawn(door.x, door.y1 - 31); // standing in the doorway
  for (let i = 0; i < 240 * 3; i++) g.step(DT, { mx: 0 });
  assert.ok(!door.closed, 'it waits while the robot is in the way');
  g.bot.spawn(door.x + 120, door.y1 - 31);
  for (let i = 0; i < 30; i++) g.step(DT, { mx: 0 });
  assert.ok(door.closed && !sw.on, 'and shuts once it is clear');
});

test('armoured glass: the line of sight goes through it, a charge bounces off it, and the robot does not pass', () => {
  const w = createWorld({ width: 4000, height: 2000, top: -1000, solids: [{ pts: box(0, 1000, 4000, 1000) }, { pts: box(1500, 700, 20, 300), kind: 'window' }, { pts: box(2400, 600, 200, 400) }] });
  const p = placeEnd(w, sightLine(w, 1200, 900, 0), 0);
  assert.ok(p && Math.abs(p.cx - 2400) < 1, 'an end opens on the wall beyond the glass');
  assert.equal(placeEnd(w, sightLine(w, 1200, 900, 0), 0).host.seg.window, false, 'and never on the glass itself');
  const c = new Charge({ x: 1300, y: 900, vx: BLASTER.speed, vy: 0, born: 0 });
  for (let t = 0; t < 0.5; t += DT) stepCharge(c, w, DT, t, {});
  assert.ok(c.x < 1500 && c.vx < 0, 'the charge came back off the glass');
  const bot = new Robot(1400, 969);
  for (let i = 0; i < 240; i++) stepRobot(bot, { mx: 1 }, w, DT);
  assert.ok(bot.x < 1500, 'and the robot is stopped by it');
});

test('a vault\'s switch is sealed in: no charge from anywhere before its door reaches it, bank or not', () => {
  const bp = piece(112, ['vault', {}]);
  const link = bp.portalLinks[0];
  const g = new Game(bp, { shields: Infinity });
  const sw = g.world.switches[0];
  for (let x = link.from.x - 5 * 40; x <= link.from.x; x += 80) {
    g.bot.spawn(x, link.from.y - 31);
    for (let i = 0; i < 30; i++) g.step(DT, { mx: 0 });
    for (let a = -Math.PI; a < Math.PI; a += 0.01) assert.ok(!shotHits(g, a, sw), `a shot at ${a.toFixed(2)} from ${x} got in`);
  }
});

test('no straight line from anywhere you can stand reaches a chimney\'s switch', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const link of bp.portalLinks.filter((l) => l.kind === 'chimney')) {
      const w = createWorld(bp);
      const sw = w.switches.find((s) => s.doors.includes(link.door));
      const door = w.doors.find((d) => d.id === link.door);
      for (let x = link.from.x - 3 * 40; x < door.x - 20; x += 10) {
        const floor = raycastSegments(x, link.from.y - 200, 0, 1, segmentsNear(w, x - 1, link.from.y - 200, x + 1, link.from.y + 60), 400);
        if (!floor || floor.seg.kind === 'spikes' || floor.y > link.from.y + 10) continue; // not somewhere to stand
        const sx = x;
        const sy = floor.y - 30.5 + ROBOT.shoulder;
        const d = Math.hypot(sw.x - sx, sw.y - sy);
        const segs = segmentsNear(w, Math.min(sx, sw.x) - 20, Math.min(sy, sw.y) - 20, Math.max(sx, sw.x) + 20, Math.max(sy, sw.y) + 20, { oneWay: false });
        const hit = raycastSegments(sx, sy, (sw.x - sx) / d, (sw.y - sy) / d, segs, d - sw.r);
        assert.ok(hit, `level ${L.id}: the chimney switch at ${Math.round(sw.x)} is in plain sight from ${x}`);
      }
    }
  }
});

test('without its black hole, no shot from before the door reaches an orbit\'s switch: it takes the curve', () => {
  const bp = piece(113, ['orbit', {}]);
  bp.wells = [];
  const link = bp.portalLinks[0];
  const g = new Game(bp, { shields: Infinity });
  const sw = g.world.switches[0];
  for (const x of link.stands) {
    g.bot.spawn(x, link.from.y - 31);
    for (let i = 0; i < 30; i++) g.step(DT, { mx: 0 });
    for (let a = -Math.PI; a < 0; a += 0.004) assert.ok(!shotHits(g, a, sw), `a straight or banked shot at ${a.toFixed(3)} from ${x} reached it`);
  }
  assert.ok(solve(new Game(piece(113, ['orbit', {}]), { shields: Infinity }), piece(113, ['orbit', {}]).portalLinks[0]).ok, 'and with it, a shot does');
});

test('a skylight cannot be climbed out of, and the face up through the hole is the way', () => {
  const bp = piece(114, ['skylight', {}]);
  const link = bp.portalLinks[0];
  const r = reachability(bp, { links: false });
  assert.ok(!r.ok && r.furthest < link.to.x, 'no jump gets out of the cave');
  const s = solve(new Game(bp, { shields: Infinity }), link);
  assert.ok(s.ok && s.aim < -0.2, `solved by looking up (${((s.aim * 180) / Math.PI).toFixed(1)} deg)`);
});

test('towers climb and shafts drop several screens, and the robot gets up and down them', () => {
  const up = piece(115, ['tower', { up: 20, lift: 5 }]);
  const down = piece(116, ['shaft', { down: 18 }]);
  const tower = up.sections.find((s) => s.type === 'tower');
  const shaft = down.sections.find((s) => s.type === 'shaft');
  assert.ok(tower.y0 - tower.y1 >= 20 * 40 && shaft.y1 - shaft.y0 >= 18 * 40, 'more than a screen of height each');
  assert.ok(reachability(up).ok, 'up the tower');
  assert.ok(reachability(down).ok, 'down the shaft');
  // A tower's only way on is up: its left wall stands over the doorway past the top.
  const g = new Game(up, { shields: Infinity });
  g.bot.spawn(tower.x0 + 4 * 40, tower.y1 - 60 - 31);
  for (let i = 0; i < 240; i++) g.step(DT, { mx: -1 });
  assert.ok(g.bot.x > tower.x0 - 40, 'no way out left at the top');
});

test('every blinking stretch in every level can be crossed in time, the long runs included', () => {
  let runs = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const sec of bp.sections.filter((s) => s.type === 'phase' || s.type === 'phaseRun')) {
      const r = crossTimed(bp, sec);
      assert.ok(r.ok, `level ${L.id}: the ${sec.type} at ${Math.round(sec.x0)} could not be crossed in time (furthest ${Math.round(r.furthest)})`);
      if (sec.type === 'phaseRun') runs++;
    }
  }
  assert.ok(runs >= 2, 'the Folded City and the Source each have a long run');
  const hard = piece(117, ['phaseRun', { on: 0.3, off: 3 }]);
  assert.ok(!crossTimed(hard, hard.sections.find((s) => s.type === 'phaseRun')).ok, 'and a run with no time to cross is caught');
});

test('the Folded City\'s long blinking run is at least four times the length of a plain blinking stretch', () => {
  const bp = level(9);
  const pitIn = (sec) => bp.pits.find((p) => p.x0 >= sec.x0 - 1 && p.x1 <= sec.x1 + 1);
  const run = pitIn(bp.sections.find((s) => s.type === 'phaseRun'));
  const plain = pitIn(bp.sections.find((s) => s.type === 'phase'));
  assert.ok(run.x1 - run.x0 >= 4 * (plain.x1 - plain.x0), `a pit ${Math.round((run.x1 - run.x0) / 40)} tiles across against ${Math.round((plain.x1 - plain.x0) / 40)}`);
});

test('levels 2 to 10 each hold at least three puzzles, of at least two kinds, and every level climbs or drops', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const kinds = new Set(bp.portalLinks.map((l) => l.kind));
    if (L.id > 1) assert.ok(bp.portalLinks.length >= 3 && kinds.size >= 2, `level ${L.id}: ${bp.portalLinks.map((l) => l.kind).join(', ')}`);
    assert.ok(bp.sections.some((s) => s.type === 'tower' || s.type === 'shaft'), `level ${L.id} has a tower or a shaft`);
  }
});

test('a jump across a pit is rarely a jump with nothing else in it', () => {
  let jumps = 0;
  let empty = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const sec of bp.sections.filter((s) => ['gap', 'plats', 'mover'].includes(s.type))) {
      jumps++;
      if (!bp.enemies.some((e) => e.x >= sec.x0 - 40 && e.x <= sec.x1 + 40)) empty++;
    }
  }
  assert.ok(empty < jumps * 0.45, `${empty} of ${jumps} jumps have nothing in them`);
});
