// Defector versus: two or three robots on an arena map, every one for
// itself. A charge from another robot costs a shield, a fall costs one and
// puts you back at the spawn furthest from everyone, and the last robot with
// shields wins. Power-ups appear every 30 to 60 seconds on a platform where
// the nearest robot is at least half as far as the next nearest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { MAPS, arenaMap } from '../src/maps.js';
import { Charge } from '../src/blaster.js';
import { BLASTER, POWER, POWERUPS, VERSUS, ROBOT } from '../src/config.js';
import { reachability } from '../tools/reach.mjs';

const DT = 1 / 240;
const match = (id = 'crossfire', n = 2, o = {}) => new Game(arenaMap(id), { mode: 'versus', players: n, shields: 5, ...o });
const run = (g, s, its = []) => {
  for (let i = 0; i < 240 * s; i++) g.step(DT, its);
};
const started = (id, n) => {
  const g = match(id, n);
  run(g, VERSUS.ready + 1.7); // the countdown, and the spawn flicker
  return g;
};
const shoot = (g, from, at, o = {}) => {
  const dx = at.bot.x - from.bot.x;
  const c = new Charge({ x: at.bot.x - Math.sign(dx) * 60, y: at.bot.y, vx: Math.sign(dx) * BLASTER.speed, vy: 0, born: g.time, owner: from.slot, ...o });
  g.charges.push(c);
  return c;
};

test('six maps, each laid out its own way', () => {
  assert.equal(MAPS.length, 6);
  const looks = new Set();
  const signatures = new Set();
  const has = { movers: 0, wells: 0, glass: 0, springs: 0, blinking: 0, crushers: 0, lasers: 0, pits: 0, spikes: 0 };
  for (const d of MAPS) {
    const bp = arenaMap(d.id);
    looks.add(d.look);
    assert.ok(bp.spawns.length >= 3, `${d.title}: a spawn for each of three robots`);
    assert.ok(bp.spots.length >= 6, `${d.title}: ${bp.spots.length} places a power-up can appear`);
    const f = {
      movers: bp.movers.filter((m) => m.path.type === 'line').length,
      wells: bp.wells.length,
      glass: bp.solids.filter((s) => s.kind === 'window').length,
      springs: bp.springs.length,
      blinking: bp.movers.filter((m) => m.path.type === 'phase').length,
      crushers: bp.movers.filter((m) => m.kind === 'crusher').length,
      lasers: bp.lasers.length,
      pits: bp.pits.length,
      spikes: bp.spikes.length,
      ledges: bp.oneWays.length,
      blocks: bp.solids.filter((s) => s.kind === 'block').length,
    };
    for (const k of Object.keys(has)) if (f[k]) has[k]++;
    signatures.add(JSON.stringify(f));
  }
  assert.equal(looks.size, 6, 'each wears a different level\'s look');
  assert.equal(signatures.size, 6, 'no two are built from the same parts');
  for (const [k, n] of Object.entries(has)) assert.ok(n >= 1, `some map has ${k}`);
  assert.ok(has.movers >= 1 && has.blinking >= 1, 'some platforms move, some blink');
});

test('on every map, every spawn and every power-up spot can be reached from every spawn', () => {
  for (const d of MAPS) {
    const bp = arenaMap(d.id);
    const targets = [...bp.spawns.map((s) => ({ x: s.x, y: s.y })), ...bp.spots.map((s) => ({ x: s.x, y: s.y + 22 - 30.5 }))];
    for (const sp of bp.spawns) {
      const r = reachability(bp, { from: sp, targets });
      const miss = targets.filter((_, i) => !r.hit[i]).map((t) => `${Math.round(t.x)},${Math.round(t.y)}`);
      assert.ok(r.ok, `${d.title}: from the spawn at ${Math.round(sp.x)},${Math.round(sp.y)} nothing reaches ${miss.join(' ')}`);
    }
  }
});

test('standing still on any spawn or power-up spot is safe', () => {
  for (const d of MAPS) {
    const bp = arenaMap(d.id);
    for (const p of [...bp.spawns, ...bp.spots.map((s) => ({ x: s.x, y: s.y + 22 - 31 }))]) {
      const g = match(d.id, 2);
      g.phase = 'play';
      const [a, b] = g.players;
      b.out = true;
      a.bot.spawn(p.x, p.y);
      run(g, 4, [{ mx: 0 }]);
      assert.ok(Math.hypot(a.bot.x - p.x, a.bot.y - p.y) < 12 && a.pool === 5, `${d.title}: at ${Math.round(p.x)},${Math.round(p.y)}`);
    }
  }
});

test('a match starts on the spawns, held through a countdown', () => {
  const g = match('crossfire', 3);
  const bp = arenaMap('crossfire');
  g.players.forEach((p, i) => assert.equal(p.bot.x, bp.spawns[i].x));
  assert.equal(g.phase, 'ready');
  run(g, VERSUS.ready - 0.2, [{ mx: 1, jump: true, jumpPressed: true, fire: true }]);
  assert.ok(Math.abs(g.players[0].bot.x - bp.spawns[0].x) < 1, 'nobody moves before the start');
  assert.equal(g.charges.length, 0, 'or fires');
  run(g, 0.4, [{ mx: 1 }]);
  assert.equal(g.phase, 'play');
  assert.ok(g.events.some((e) => e.s === 'go'));
  run(g, 0.5, [{ mx: 1 }]);
  assert.ok(g.players[0].bot.x > bp.spawns[0].x + 20, 'then off they go');
});

test('another robot\'s charge costs a shield; your own go through you, and so does anything while you flicker', () => {
  const g = started('crossfire', 2);
  const [a, b] = g.players;
  a.bot.spawn(600, -31);
  b.bot.spawn(1400, -31);
  run(g, 0.2);
  b.bot.invuln = 0;
  shoot(g, a, b);
  run(g, 0.3);
  assert.equal(b.pool, 4, 'hit');
  assert.equal(a.stats.hits, 1, 'and it counts for the one who fired');
  assert.ok(b.bot.invuln > 0);
  shoot(g, a, b);
  run(g, 0.3);
  assert.equal(b.pool, 4, 'flickering, the next goes through');
  b.bot.invuln = 0;
  shoot(g, b, b);
  run(g, 0.3);
  assert.equal(b.pool, 4, 'its own charge never hurts it');
});

test('a Hammer charge costs two shields, and a Frost one holds a robot fast instead', () => {
  const g = started('crossfire', 2);
  const [a, b] = g.players;
  a.bot.spawn(600, -31);
  b.bot.spawn(1400, -31);
  run(g, 0.2);
  b.bot.invuln = 0;
  shoot(g, a, b, { damage: POWER.strongDamage, kind: 'strong' });
  run(g, 0.3);
  assert.equal(b.pool, 3);
  b.bot.invuln = 0;
  shoot(g, a, b, { freeze: true, kind: 'freeze' });
  run(g, 0.3);
  assert.equal(b.pool, 3, 'no shield for the frost');
  assert.ok(b.frozen > 0);
  const x = b.bot.x;
  run(g, 1, [{ mx: 0 }, { mx: -1, fire: true }]);
  assert.ok(Math.abs(b.bot.x - x) < 1 && g.chargesOf(b) === 0, 'it cannot move or fire while frozen');
  run(g, VERSUS.frozen, [{ mx: 0 }, { mx: -1 }]);
  assert.ok(b.bot.x < x - 20, 'and then it thaws');
});

test('a fall costs a shield and puts the robot back at the spawn furthest from the others', () => {
  const g = started('drift', 2);
  const [a, b] = g.players;
  const bp = arenaMap('drift');
  b.bot.spawn(bp.spawns[0].x + 40, bp.spawns[0].y); // standing near the first spawn
  a.bot.spawn(1000, 300); // down the drop
  for (let i = 0; i < 240 && a.pool === 5; i++) g.step(DT, [{ mx: 0 }, { mx: 0 }]);
  assert.equal(a.pool, 4);
  const far = bp.spawns.reduce((best, s) => (Math.hypot(s.x - b.bot.x, s.y - b.bot.y) > Math.hypot(best.x - b.bot.x, best.y - b.bot.y) ? s : best));
  assert.ok(Math.abs(a.bot.x - far.x) < 2, `back at ${Math.round(a.bot.x)}, the spawn at ${far.x} being furthest from the other robot`);
});

test('the last robot with shields wins the match', () => {
  const g = started('crossfire', 3);
  const [a, b, c] = g.players;
  for (const p of [b, c]) {
    for (let k = 0; k < 5; k++) {
      p.bot.invuln = 0;
      g.hurt('shot', null, false, p);
    }
  }
  assert.ok(b.out && c.out && !a.out);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
  assert.ok(g.events.some((e) => e.s === 'over' && e.winner === 0));
  assert.equal(g.charges.filter((x) => x.owner !== 0).length, 0, 'what the losers had in the air goes with them');
});

test('power-ups appear every 30 to 60 seconds, a real power-up each time, and never more than three lying about', () => {
  let seed = 99;
  const g = match('crossfire', 2, { rng: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
  run(g, VERSUS.ready + 1.7);
  const gaps = [];
  let last = 0; // the first is timed from the start of the match
  let n = 0;
  for (let k = 0; k < 60; k++) {
    const due = g.nextPower;
    assert.ok(due - last >= VERSUS.powerMin - 1e-9 && due - last <= VERSUS.powerMax + 1e-9, `the next one ${(due - last).toFixed(1)} s on`);
    gaps.push(due - last);
    g.time = due;
    const before = g.pickups.length;
    g.stepVersus();
    last = g.time;
    if (g.pickups.length > before) {
      n++;
      const p = g.pickups[g.pickups.length - 1];
      assert.ok(POWERUPS.some((q) => q.id === p.kind), p.kind);
      assert.equal(p.owner, null, 'anyone can take it');
    }
    assert.ok(g.pickups.length <= VERSUS.powerCap);
    if (k % 4 === 3) g.pickups.length = 0; // taken
  }
  assert.ok(n >= 40, `${n} appeared`);
  assert.ok(Math.min(...gaps) < 35 && Math.max(...gaps) > 55, 'the whole range is used');
});

test('a power-up appears where the nearest robot is no nearer than half as far as the next nearest', () => {
  let checked = 0;
  let rng = 12345;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (const d of MAPS) {
    const bp = arenaMap(d.id);
    const places = [...bp.spawns, ...bp.spots];
    for (let k = 0; k < 40; k++) {
      const g = match(d.id, 3, { rng: rand });
      g.phase = 'play';
      for (const p of g.players) {
        const at = places[Math.floor(rand() * places.length)];
        p.bot.spawn(at.x + (rand() - 0.5) * 60, at.y);
      }
      const any = bp.spots.some((s) => g.fairness(s.x, s.y) >= VERSUS.fair);
      const s = g.powerSpot();
      if (!any) continue;
      const dist = g.players.map((p) => Math.hypot(p.bot.x - s.x, p.bot.y - s.y)).sort((a, b) => a - b);
      assert.ok(dist[0] >= VERSUS.fair * dist[1], `${d.title}: nearest ${Math.round(dist[0])} against ${Math.round(dist[1])}`);
      checked++;
    }
  }
  assert.ok(checked > 200, `${checked} placements checked`);
  // With nowhere fair (both robots on the same spot), it takes the fairest there is rather than none.
  const g = match('crossfire', 2);
  g.phase = 'play';
  for (const p of g.players) p.bot.spawn(1000, -491);
  assert.ok(g.powerSpot(), 'still somewhere');
});

test('a power-up taken is loaded into the blaster, and it is the one who took it who has it', () => {
  const g = started('crossfire', 2);
  const [a, b] = g.players;
  const s = arenaMap('crossfire').spots[0];
  g.pickups.push(g.makePickup('big', s.x, s.y, null, true));
  a.bot.spawn(s.x, s.y + 22 - 31);
  run(g, 0.5);
  assert.equal(a.loaded, 'big');
  assert.equal(b.ammo.big, 0);
  assert.equal(ROBOT.r, a.bot.r);
});
