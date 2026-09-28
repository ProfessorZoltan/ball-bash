// Versus: four arenas, every robot for itself. Each arena can be crossed from
// every spawn to every other spawn and every power-up spot; standing still on
// any of them is safe; and the rules hold: the countdown, a hit and where it
// puts you, Frost, a Hammer, your own charges, the last one standing, and
// where and when a power-up appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { MAPS, arenaMap } from '../src/maps.js';
import { makeCharge } from '../src/blaster.js';
import { VERSUS, PHYSICS_DT, ROBOT } from '../src/config.js';
import { VECTOR_TRACKS } from '../src/tracks.js';
import { tour } from '../tools/tour.mjs';

const DT = PHYSICS_DT;

/** A versus match past its countdown. */
function match(id, n = 2, o = {}) {
  const g = new Game(arenaMap(id), { mode: 'versus', players: n, shields: 5, maxShields: 5, rng: () => 0.37, ...o });
  for (let t = 0; t < VERSUS.ready + 0.05; t += DT) g.step(DT, []);
  return g;
}

/** A charge of `owner`'s, fired at `pl` from a metre away. */
function shoot(g, owner, pl, kind = 'std') {
  const at = [pl.bot.pos[0], pl.bot.pos[1] + 0.3, pl.bot.pos[2] - 1];
  const c = makeCharge(at, [0, 0, 1], kind, owner);
  g.charges.push(c);
  return c;
}

test('there are four arenas, each its own shape, look and music, with a spawn for every robot', () => {
  assert.equal(MAPS.length, 4);
  const looks = new Set();
  const shapes = new Set();
  for (const m of MAPS) {
    const bp = arenaMap(m.id);
    looks.add(m.look);
    shapes.add(bp.world.solids.map((s) => `${s.shape}:${s.min.map((v) => v.toFixed(1))}:${s.max.map((v) => v.toFixed(1))}`).sort().join('|'));
    assert.ok(bp.spawns.length >= 3, `${m.title} has a spawn for each of three robots`);
    assert.ok(bp.spots.length >= 4, `${m.title} has places for power-ups`);
    assert.ok(VECTOR_TRACKS[bp.track], `${m.title} has music`);
    assert.ok(m.blurb, `${m.title} says what it is`);
  }
  assert.equal(looks.size, MAPS.length, 'no two arenas wear the same level');
  assert.equal(shapes.size, MAPS.length, 'no two arenas are built from the same parts');
});

test('in every arena, every spawn and every power-up spot is reached from every spawn, without a shield lost', () => {
  for (const m of MAPS) {
    const n = arenaMap(m.id).spawns.length;
    for (let si = 0; si < n; si++) {
      const r = tour(m.id, si);
      assert.ok(r.ok, `${m.title} from spawn ${si}: ${r.why}`);
    }
  }
});

test('standing still on any spawn or power-up spot is safe', () => {
  for (const m of MAPS) {
    const bp = arenaMap(m.id);
    for (const p of [...bp.spawns.map((s) => s.p), ...bp.spots.map((s) => [s[0], s[1] + 0.001, s[2]])]) {
      const g = new Game(arenaMap(m.id), { mode: 'versus', players: 1, shields: 5, maxShields: 5 });
      g.phase = 'fight';
      g.bot.spawn(p, 0);
      let hurt = null;
      for (let t = 0; t < 12; t += DT) {
        g.step(DT, {});
        const e = g.events.find((x) => x.s === 'hurt');
        if (e) hurt = e.why;
        g.events.length = 0;
      }
      assert.equal(hurt, null, `${m.title}: standing at ${p.map((v) => v.toFixed(1))} costs a shield (${hurt})`);
      assert.ok(Math.abs(g.bot.pos[1] - p[1]) < 0.2 && Math.hypot(g.bot.pos[0] - p[0], g.bot.pos[2] - p[2]) < 0.2, `${m.title}: nothing moves a robot standing at ${p.map((v) => v.toFixed(1))}`);
    }
  }
});

test('the countdown holds every robot on its spawn, then the fight starts', () => {
  const g = new Game(arenaMap('crossfire'), { mode: 'versus', players: 2 });
  const at = g.players.map((p) => [...p.bot.pos]);
  for (let t = 0; t < VERSUS.ready - 0.1; t += DT) g.step(DT, [{ mz: 1, firePress: true }, { mz: 1 }]);
  g.players.forEach((p, i) => assert.ok(Math.hypot(p.bot.pos[0] - at[i][0], p.bot.pos[2] - at[i][2]) < 0.01, 'held on its spawn'));
  assert.equal(g.charges.length, 0, 'and cannot fire');
  for (let t = 0; t < 0.3; t += DT) g.step(DT, [{ mz: 1 }, {}]);
  assert.equal(g.phase, 'fight');
  assert.ok(Math.hypot(g.players[0].bot.pos[0] - at[0][0], g.players[0].bot.pos[2] - at[0][2]) > 0.2, 'then it moves');
});

test('another robot\'s charge costs a shield and puts you at the spawn furthest from everyone, flickering', () => {
  const g = match('horizon', 3);
  const [a, b, c] = g.players;
  b.bot.spawn(g.bp.spawns[1].p, 0);
  c.bot.spawn(g.bp.spawns[3].p, 0);
  a.bot.spawn([0, 0.91, 12.5], 0);
  shoot(g, 1, a);
  for (let i = 0; i < 20 && a.shields === 5; i++) g.step(DT, []);
  assert.equal(a.shields, 4, 'a shield lost');
  assert.equal(b.stats.hits, 1, 'and a hit to the one who fired');
  assert.ok(a.bot.invuln > ROBOT.invuln - 0.1, 'flickering');
  const far = g.spawnSpot(a);
  assert.ok(Math.hypot(a.bot.pos[0] - far.p[0], a.bot.pos[2] - far.p[2]) < 0.5, 'back at a spawn');
  const dists = g.bp.spawns.map((s) => Math.min(...[b, c].map((q) => Math.hypot(q.bot.pos[0] - s.p[0], q.bot.pos[2] - s.p[2]))));
  assert.equal(Math.min(...[b, c].map((q) => Math.hypot(q.bot.pos[0] - a.bot.pos[0], q.bot.pos[2] - a.bot.pos[2]))).toFixed(3), Math.max(...dists).toFixed(3), 'the one furthest from the others');
  // Flickering, anything goes through it.
  const n = a.shields;
  shoot(g, 1, a);
  for (let i = 0; i < 20; i++) g.step(DT, []);
  assert.equal(a.shields, n, 'a flickering robot is not hit again');
});

test('your own charges never hurt you; a Hammer takes two shields; Frost holds you fast and takes none', () => {
  const g = match('crossfire');
  const [a, b] = g.players;
  a.bot.spawn([0, 0.91, 14], 0);
  b.bot.spawn([0, 0.91, -14], Math.PI);
  shoot(g, 0, a);
  for (let i = 0; i < 20; i++) g.step(DT, []);
  assert.equal(a.shields, 5, 'your own charge goes through you');
  shoot(g, 0, b, 'strong');
  for (let i = 0; i < 20 && b.shields === 5; i++) g.step(DT, []);
  assert.equal(b.shields, 3, 'a Hammer takes two');
  a.bot.spawn([0, 0.91, 14], 0);
  shoot(g, 1, a, 'freeze');
  for (let i = 0; i < 20 && !(a.bot.frozen > 0); i++) g.step(DT, []);
  assert.equal(a.shields, 5, 'Frost takes no shield');
  assert.ok(a.bot.frozen > VERSUS.frozen - 0.2, 'it holds the robot');
  const at = [...a.bot.pos];
  const shots = a.stats.shots;
  for (let t = 0; t < 1.5; t += DT) g.step(DT, [{ mz: 1, firePress: true }, {}]);
  assert.ok(Math.hypot(a.bot.pos[0] - at[0], a.bot.pos[2] - at[2]) < 0.01, 'it cannot move');
  assert.equal(a.stats.shots, shots, 'nor fire');
  for (let t = 0; t < 1; t += DT) g.step(DT, [{ mz: 1 }, {}]);
  assert.ok(Math.hypot(a.bot.pos[0] - at[0], a.bot.pos[2] - at[2]) > 0.2, 'and then it can');
});

test('a robot with no shields left is out, and the last one standing wins', () => {
  const g = match('yard', 3, { shields: 1, maxShields: 1 });
  const [a, b, c] = g.players;
  for (const [pl, at] of [[a, [-8, 0.91, 12.5]], [b, [8, 0.91, 12.5]], [c, [20, 0.91, -15]]]) pl.bot.spawn(at, 0);
  shoot(g, 2, a);
  for (let i = 0; i < 20 && !a.out; i++) g.step(DT, []);
  assert.ok(a.out, 'out');
  assert.equal(g.state, 'play', 'and the match goes on');
  assert.ok(!a.ends[0] && !a.ends[1] && g.mine(a) === 0, 'its ends shut and its charges gone');
  shoot(g, 2, b);
  for (let i = 0; i < 20 && !b.out; i++) g.step(DT, []);
  assert.equal(g.state, 'over');
  assert.equal(g.winner, 2);
});

test('a fall costs a shield and puts the robot back at a spawn', () => {
  const g = match('horizon');
  const a = g.players[0];
  a.bot.spawn([0, 0.91, 6], 0);
  for (let t = 0; t < 4 && a.shields === 5; t += DT) g.step(DT, [{}, {}]);
  assert.equal(a.shields, 4, 'the pit takes a shield');
  assert.ok(g.bp.spawns.some((s) => Math.hypot(a.bot.pos[0] - s.p[0], a.bot.pos[2] - s.p[2]) < 0.5), 'and puts it at a spawn');
});

test('a power-up appears every 30 to 60 seconds, never more than three, and never much nearer one robot than the next', () => {
  for (const m of MAPS) {
    let r = 0.1;
    const g = match(m.id, 3, { rng: () => (r = (r * 9301 + 49297) % 233280 / 233280) });
    const times = [];
    let last = g.pickups.length;
    for (let t = 0; t < 400; t += DT) {
      g.step(DT, []);
      if (g.pickups.length !== last) {
        times.push(g.time);
        last = g.pickups.length;
      }
      assert.ok(g.pickups.filter((p) => !p.taken).length <= VERSUS.powerCap);
    }
    assert.ok(times.length >= 3, `${m.title}: power-ups appear`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= VERSUS.powerMin - 0.01 && times[i] - times[i - 1] <= VERSUS.powerMax + 0.01, `${m.title}: ${(times[i] - times[i - 1]).toFixed(1)} s apart`);
  }
  // Fairness, over hundreds of placements with the robots scattered about.
  for (const m of MAPS) {
    let r = 0.5;
    const rnd = () => (r = (r * 9301 + 49297) % 233280 / 233280);
    const g = match(m.id, 3, { rng: rnd });
    for (let k = 0; k < 300; k++) {
      for (const pl of g.players) {
        const s = g.bp.spawns[Math.floor(rnd() * g.bp.spawns.length)];
        pl.bot.pos = [s.p[0] + (rnd() - 0.5) * 6, s.p[1], s.p[2] + (rnd() - 0.5) * 6];
      }
      const spot = g.powerSpot();
      const fairest = Math.max(...g.bp.spots.map((s) => g.fairness(s)));
      assert.ok(g.fairness(spot) >= Math.min(VERSUS.fair, fairest) - 1e-9, `${m.title}: a spot nobody is much nearer (${g.fairness(spot).toFixed(2)})`);
    }
  }
});

test('Event Horizon: standing on the bridge under the hole is safe, and a jump there is taken', () => {
  const g = match('horizon');
  const a = g.players[0];
  a.bot.spawn([0, 0.91, 0], 0);
  for (let t = 0; t < 2; t += DT) g.step(DT, [{}, {}]);
  assert.equal(a.shields, 5, 'standing is safe');
  let why = null;
  for (let t = 0; t < 3 && !why; t += DT) {
    g.step(DT, [{ jump: true, jumpPress: t < DT }, {}]);
    const e = g.events.find((x) => x.s === 'hurt' && x.slot === 0);
    if (e) why = e.why;
    g.events.length = 0;
  }
  assert.equal(why, 'horizon', 'a jump is drawn up into the hole');
});
