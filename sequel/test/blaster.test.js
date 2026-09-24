// Defector: the blaster's charge and the five power-ups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, box } from '../src/world.js';
import { Charge, chargeSpec, stepCharge, guideLine } from '../src/blaster.js';
import { Game } from '../src/game.js';
import { buildLevel } from '../src/build.js';
import { Enemy } from '../src/enemies.js';
import { BLASTER, POWER, BALL, VOLLEY } from '../src/config.js';
import { volleySpeed } from '../../src/config.js';

const DT = 1 / 240;
const room = (extra = {}) =>
  createWorld({
    width: 4000,
    height: 2000,
    top: -1000,
    solids: [{ pts: box(0, 1500, 4000, 500) }, { pts: box(-200, -1000, 200, 3000) }, { pts: box(4000, -1000, 200, 3000) }, { pts: box(0, -1000, 4000, 200) }],
    ...extra,
  });

/** A flat stretch of level with nothing on it, and a Game on it. */
function field(extra = {}) {
  const bp = buildLevel({ id: 80, boss: 'gardener', theme: {}, sections: [['flat', { len: 40, deco: false }]] });
  Object.assign(bp, extra);
  return new Game(bp, { shields: 5, rng: () => 0.5 });
}

test('the charge is Deflector\'s: the middle of the ball\'s speed range, the ball\'s size, three seconds of life', () => {
  const spec = chargeSpec('std');
  assert.equal(BLASTER.speed, volleySpeed(BALL.maxSpeed));
  assert.equal(spec.r, VOLLEY.radius);
  assert.equal(spec.life, 3);
  const w = room();
  const c = new Charge({ x: 2000, y: 400, vx: BLASTER.speed, vy: 0, born: 0 });
  let t = 0;
  while (stepCharge(c, w, DT, t, {})) t += DT;
  assert.ok(Math.abs(t - 3) < 0.01, `it lived ${t.toFixed(3)} s`);
});

test('a charge leaves a wall at the speed it arrived, however many times it bounces', () => {
  const w = createWorld({ width: 800, height: 900, top: 0, solids: [{ pts: box(0, 800, 800, 100) }, { pts: box(-100, 0, 100, 900) }, { pts: box(800, 0, 100, 900) }, { pts: box(0, -100, 800, 100) }] });
  const c = new Charge({ x: 400, y: 400, vx: BLASTER.speed * 0.6, vy: BLASTER.speed * 0.8, born: 0 });
  let t = 0;
  while (stepCharge(c, w, DT, t, {}) && t < 2.9) t += DT;
  assert.ok(c.bounces >= 4, `it bounced ${c.bounces} times`);
  assert.ok(Math.abs(c.speed - BLASTER.speed) < 1e-6);
});

test('a moving platform lends a charge its motion, as a moving shield does the ball', () => {
  const w = room({ movers: [{ x: 1900, y: 600, w: 300, h: 30, path: { type: 'line', dx: 0, dy: -400, period: 2, phase: Math.PI / 2 } }] });
  w.t = 0;
  const m = w.movers[0];
  m.update(DT, 0);
  const c = new Charge({ x: 2050, y: 300, vx: 0, vy: 500, born: 0 });
  let t = 0;
  let bounced = false;
  for (; t < 1 && !bounced; t += DT) {
    w.t += DT;
    m.update(DT, w.t);
    stepCharge(c, w, DT, t, { bounce: () => (bounced = true) });
  }
  assert.ok(bounced && c.vy < 0, 'it came back up off the platform');
  assert.ok(c.speed > 500 + 50, `a platform coming up to meet it sped it up, to ${c.speed.toFixed(0)}`);
});

test('the durable charge lives six seconds instead of three', () => {
  assert.equal(chargeSpec('durable').life, 6);
  assert.equal(POWER.durableLife, 6);
});

test('the triple shot fires three charges a degree apart', () => {
  const g = field();
  g.ammo.triple = 5;
  g.loaded = 'triple';
  g.bot.aim = 0;
  g.fire();
  assert.equal(g.charges.length, 3);
  const angles = g.charges.map((c) => Math.atan2(c.vy, c.vx)).sort((a, b) => a - b);
  const degree = Math.PI / 180;
  assert.ok(Math.abs(angles[1] - angles[0] - degree) < 1e-9 && Math.abs(angles[2] - angles[1] - degree) < 1e-9);
  assert.equal(g.ammo.triple, 4, 'one volley is one charge of ammunition');
});

test('the titan charge is three times the size and the hammer does double damage', () => {
  assert.equal(chargeSpec('big').r, VOLLEY.radius * 3);
  assert.equal(chargeSpec('strong').damage, 2 * chargeSpec('std').damage);
  const g = field();
  const e = new Enemy({ kind: 'trundle', x: 700, y: -31 }, 0);
  e.awake = true;
  g.enemies.push(e);
  const hp = e.hp;
  g.damageEnemy(e, new Charge({ x: 0, y: 0, vx: 0, vy: 0, damage: chargeSpec('strong').damage }));
  assert.equal(e.hp, hp - 2);
});

test('a frost charge freezes an enemy solid for five seconds, and the robot can stand on it', () => {
  const g = field();
  const e = new Enemy({ kind: 'drifter', x: 700, y: -200 }, 0);
  e.awake = true;
  g.enemies.push(e);
  g.damageEnemy(e, new Charge({ x: 0, y: 0, vx: 0, vy: 0, freeze: true }));
  assert.equal(e.frozen, POWER.freeze);
  assert.equal(e.hp, e.maxHp, 'frost does no damage');
  g.bot.spawn(e.x, e.y - e.r - 60);
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0 });
  assert.ok(g.bot.onGround && g.bot.bottom < e.y, 'the robot stands on the frozen drifter in mid-air');
  for (let i = 0; i < 240 * 4.5; i++) g.step(DT, { mx: 0 });
  assert.equal(e.frozen, 0, 'it thaws after five seconds');
});

test('power-ups load charges, cycle with the standard one, and run out back to it', () => {
  const g = field();
  g.take({ kind: 'strong', x: 0, y: 0 });
  assert.equal(g.ammo.strong, POWER.ammo);
  assert.equal(g.loaded, 'strong', 'the first of a kind is loaded straight away');
  g.take({ kind: 'freeze', x: 0, y: 0 });
  assert.deepEqual(g.loadable(), ['std', 'freeze', 'strong']);
  g.cycle();
  assert.equal(g.loaded, 'std');
  g.cycle();
  assert.equal(g.loaded, 'freeze');
  g.ammo.freeze = 1;
  g.fire();
  assert.equal(g.loaded, 'std', 'the last one fired, it goes back to the standard charge');
});

test('a black hole bends a charge, and its horizon takes it', () => {
  const w = room({ wells: [{ x: 2000, y: 700, r: 26, range: 500, pull: 500000 }] });
  const straight = new Charge({ x: 1500, y: 560, vx: BLASTER.speed, vy: 0, born: 0 });
  let swallowed = false;
  let t = 0;
  while (stepCharge(straight, w, DT, t, { swallow: () => (swallowed = true) }) && t < 3) t += DT;
  assert.ok(swallowed || Math.abs(straight.vy) > 100, 'it was pulled off its line');
  const into = new Charge({ x: 1500, y: 700, vx: BLASTER.speed, vy: 0, born: 0 });
  swallowed = false;
  t = 0;
  while (stepCharge(into, w, DT, t, { swallow: () => (swallowed = true) }) && t < 3) t += DT;
  assert.ok(swallowed, 'straight at it, the horizon takes it');
});

test('the targeting line is the path the charge then flies', () => {
  const w = room({ wells: [{ x: 2300, y: 650, r: 26, range: 500, pull: 300000 }] });
  const spec = chargeSpec('std');
  const [legs] = guideLine(w, 1800, 1000, -0.4, spec, 0, 1);
  const line = legs.flat();
  assert.ok(line.length > 100, 'the line runs the whole second');
  const c = new Charge({ x: 1800, y: 1000, vx: Math.cos(-0.4) * BLASTER.speed, vy: Math.sin(-0.4) * BLASTER.speed, born: 0 });
  for (let i = 0; i < 60; i++) stepCharge(c, w, 1 / 120, i / 120, {});
  const p = line[60];
  assert.ok(Math.hypot(p[0] - c.x, p[1] - c.y) < 1e-6, 'the half-second mark on the line is where the charge is');
  assert.ok(Math.abs(Math.atan2(c.vy, c.vx) + 0.4) > 0.05, 'and the well has bent both');
});

test('a press fires one charge, and holding the button fires no more', () => {
  const g = field();
  g.bot.aim = -0.3;
  g.step(DT, { mx: 0, fire: true });
  assert.equal(g.charges.length, 1, 'the press fired');
  for (let i = 0; i < 240; i++) g.step(DT, { mx: 0, fire: false });
  assert.equal(g.charges.length, 1, 'holding it down is not another press');
});

test('no more than six of the robot\'s charges are ever in the air, and a trident needs room for all three', () => {
  const g = field();
  g.bot.aim = -1.2;
  assert.equal(BLASTER.maxAlive, 6);
  let most = 0;
  for (let i = 0; i < 240 * 4; i++) {
    g.step(DT, { mx: 0, fire: i % 60 === 0 });
    most = Math.max(most, g.charges.length);
  }
  assert.equal(most, 6, 'pressing as fast as the blaster cools puts six up, never a seventh');
  assert.ok(g.events.some((e) => e.s === 'dry'), 'and a refused press is heard');
  const t = field();
  t.bot.aim = -1.2;
  t.ammo.triple = 10;
  t.loaded = 'triple';
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 240 * BLASTER.cooldown + 2; k++) t.step(DT, { mx: 0 });
    t.fire();
  }
  assert.equal(t.charges.length, 6, 'two volleys of three, and the third waits');
  assert.equal(t.ammo.triple, 8, 'a refused volley costs nothing');
});

test('a press while the blaster is still cooling fires the moment it is ready', () => {
  const g = field();
  g.bot.aim = -0.3;
  g.step(DT, { mx: 0, fire: true });
  g.step(DT, { mx: 0, fire: true });
  assert.equal(g.charges.length, 1);
  for (let i = 0; i < 240 * BLASTER.cooldown + 2; i++) g.step(DT, { mx: 0 });
  assert.equal(g.charges.length, 2, 'the early press was kept, not lost');
});
