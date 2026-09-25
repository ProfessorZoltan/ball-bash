// Defector's netcode, run between a host and a guest in one process over a
// pretend network (every message through JSON, late by a changing amount,
// and some lost): the guest's own robot agrees with the host's, everything
// else follows the host, and a guest's inputs do in the host's game what
// they did on the guest's screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, IDLE } from '../src/game.js';
import { level } from '../src/levels.js';
import { arenaMap } from '../src/maps.js';
import { BOSS_ORDER } from '../src/bosses.js';
import { LEVEL_DEFS } from '../src/levels.js';
import { HostLink, HostQueue, GuestInputs, Mirror, packIntent, unpackIntent, recordStep, PRESSES, NET, MSG } from '../src/netplay.js';
import { drawBoss, drawEnemy, drawRobot } from '../src/art.js';

const DT = 1 / 240;

test('an intent packs into three numbers and back, and a press is only on the first step of a record', () => {
  const it = { mx: -0.5, run: true, jump: true, jumpPressed: true, down: false, fire: true, cycle: false, worm: [false, true], aim: -1.23456 };
  const [mx, bits, aim] = packIntent(it);
  const back = unpackIntent(mx, bits, aim);
  assert.deepEqual(back, { ...it, aim: -1.2346 });
  const rec = [7, 3, mx, bits, aim];
  assert.ok(recordStep(rec, 0).fire && recordStep(rec, 0).jumpPressed && recordStep(rec, 0).worm[1]);
  for (const i of [1, 2]) {
    const s = recordStep(rec, i);
    assert.ok(!s.fire && !s.jumpPressed && !s.worm[1], 'no presses after the first step');
    assert.ok(s.jump && s.run && s.mx === -0.5, 'but held buttons stay held');
  }
  assert.equal(bits & PRESSES, bits & ~(1 | 2 | 8));
});

test('the host plays a guest\'s records in order, each for its steps, waits when they run dry, and acks what it has played', () => {
  const q = new HostQueue();
  assert.deepEqual(q.next(), [], 'nothing yet: the robot waits');
  q.push([[1, 4, 1, 0, 0], [2, 4, -1, 16, 0]]);
  const played = [];
  for (let i = 0; i < 8; i++) played.push(...q.next());
  assert.equal(played.length, 8);
  assert.ok(played.slice(0, 4).every((it) => it.mx === 1));
  assert.ok(played[4].fire && played.slice(5).every((it) => it.mx === -1 && !it.fire), 'a press once, on its record\'s first step');
  assert.deepEqual(q.ackPair(), [2, 0]);
  q.push([[1, 4, 1, 0, 0], [2, 4, -1, 16, 0]]);
  assert.equal(q.depth, 0, 'a repeated record is not played twice');
  assert.deepEqual(q.next(), [], 'dry: it waits');
});

test('a match drops what is left over from the one before: the last inputs and snapshots of it are still on their way when it starts', () => {
  const bp = arenaMap('crossfire');
  const host = new Game(bp, { mode: 'versus', players: 2, local: 0 });
  host.phase = 'play';
  const hl = new HostLink(host, 2);
  // The old match's guest was up to record 331; the new one starts again from 1.
  hl.input(1, { t: MSG.input, m: 1, r: [[331, 4, 1, 0, 0]] });
  const fresh = new GuestInputs(2);
  const msgs = [];
  for (let k = 0; k < 20; k++) {
    fresh.record({ mx: -1 }, 4);
    msgs.push(fresh.message(null));
  }
  const x = host.players[1].bot.x;
  for (const m of msgs) {
    assert.equal(m.m, 2, 'each input says which match it is for');
    hl.input(1, JSON.parse(JSON.stringify(m)));
    for (let k = 0; k < 4; k++) host.step(DT, hl.intents(IDLE));
  }
  assert.ok(host.players[1].bot.x < x - 20, 'the guest\'s robot moves in the new match');
  const s = hl.snapshot();
  assert.equal(s.m, 2);
  const mirror = new Mirror(new Game(bp, { mode: 'versus', players: 2, local: 1 }), 1, 3);
  assert.equal(mirror.receive(JSON.parse(JSON.stringify(s)), 0), false, 'and a guest in another match takes no snapshot of this one');
});

/** A pretend network: late by 40 to 90 ms each way, and one message in twenty lost. */
function link(seed = 7) {
  let r = seed;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const q = [];
  return {
    send(msg, now) {
      if (rand() < 0.05) return;
      q.push({ at: now + 0.04 + rand() * 0.05, text: JSON.stringify(msg) });
    },
    take(now) {
      const out = q.filter((m) => m.at <= now).sort((a, b) => a.at - b.at);
      for (const m of out) q.splice(q.indexOf(m), 1);
      return out.map((m) => JSON.parse(m.text));
    },
  };
}

/**
 * A host and a guest playing `bp` for `seconds`, the guest's robot doing
 * what `guestPlays(t)` says and the host's what `hostPlays(t)` says. Runs
 * at 60 frames a second, four physics steps each; the host snapshots every
 * other frame. Returns everything, drained (the network given time to catch
 * up at the end with nobody pressing anything).
 */
function play(bp, seconds, guestPlays, hostPlays = () => IDLE, opts = {}) {
  const mode = opts.mode || 'coop';
  const host = new Game(bp, { mode, players: 2, local: 0, shields: 99, rng: () => 0.4 });
  const guestGame = new Game(bp, { mode, players: 2, local: 1, shields: 99, rng: () => 0.4 });
  if (opts.setup) {
    opts.setup(host);
    opts.setup(guestGame);
  }
  const hl = new HostLink(host);
  const mirror = new Mirror(guestGame, 1);
  const inputs = new GuestInputs();
  const up = link(11);
  const down = link(23);
  let now = 0;
  let frame = 0;
  const sizes = [];
  const tick = (git, hit) => {
    now += 1 / 60;
    frame++;
    const rec = inputs.record(git, 4);
    if (rec) mirror.predict(rec);
    up.send(inputs.message(null), now);
    for (const m of up.take(now)) hl.input(1, m);
    for (let k = 0; k < 4; k++) host.step(DT, hl.intents(k === 0 ? hit : { ...hit, jumpPressed: false, fire: false, worm: [false, false], cycle: false }));
    hl.events(host.events);
    host.events.length = 0;
    if (frame % 2 === 0) {
      const s = hl.snapshot();
      sizes.push(JSON.stringify(s).length);
      down.send(s, now);
    }
    for (const m of down.take(now)) mirror.receive(m, now);
    mirror.show(now);
    mirror.fade(1 / 60);
    if (opts.each) opts.each(host, guestGame, now);
  };
  for (let t = 0; t < seconds; t += 1 / 60) tick(guestPlays(t), hostPlays(t));
  for (let t = 0; t < 1; t += 1 / 60) tick(IDLE, IDLE);
  return { host, guest: guestGame, mirror, hl, sizes };
}

/** Pressed on the frame each period starts. */
const every = (t, period) => Math.floor(t / period) !== Math.floor((t - 1 / 60) / period);
/** Running right with jumps, hops, shots and a turn now and then. */
const busy = (t) => ({ mx: t % 5 < 4 ? 1 : -1, run: t % 3 > 1, jump: t % 1.1 < 0.35, jumpPressed: every(t, 1.1), aim: -0.3, fire: every(t, 0.7) });

test('a guest\'s own robot, predicted, agrees with the host\'s: corrections are nothing, and it ends where the host has it', () => {
  const r = play(level(1), 12, busy);
  const hb = r.host.players[1].bot;
  const gb = r.guest.players[1].bot;
  assert.ok(Math.hypot(hb.x - gb.x, hb.y - gb.y) < 0.5, `ends at ${gb.x.toFixed(1)},${gb.y.toFixed(1)} against the host's ${hb.x.toFixed(1)},${hb.y.toFixed(1)}`);
  const c = r.mirror.corrections;
  const small = c.filter((d) => d < 1).length;
  assert.ok(small >= 0.95 * c.length, `${small} of ${c.length} corrections under a pixel (the largest ${Math.max(...c).toFixed(1)})`);
  assert.ok(hb.x > 900, `the guest's robot really went somewhere in the host's game (${Math.round(hb.x)})`);
});

test('riding moving platforms, a guest\'s predicted robot still agrees with the host\'s', () => {
  const bp = arenaMap('drift');
  const deck = bp.movers[0];
  // On the lower deck as it slides, then a hop to the upper one and the lift, and back.
  const r = play(bp, 10, (t) => ({ mx: t < 3 ? 0 : t % 2 < 1 ? 0.6 : -0.6, jump: t % 1.5 < 0.4, jumpPressed: every(t, 1.5) && t > 3, aim: 0 }), () => IDLE, {
    mode: 'versus',
    setup: (g) => {
      g.phase = 'play';
      g.players[0].bot.spawn(140, -31);
      g.players[1].bot.spawn(deck.x + 60, deck.y - 31);
    },
  });
  const c = r.mirror.corrections;
  const small = c.filter((d) => d < 1).length;
  assert.ok(small >= 0.9 * c.length, `${small} of ${c.length} corrections under a pixel (the largest ${Math.max(...c).toFixed(1)})`);
  const hb = r.host.players[1].bot;
  const gb = r.guest.players[1].bot;
  assert.ok(Math.hypot(hb.x - gb.x, hb.y - gb.y) < 1, `ends where the host has it (${Math.hypot(hb.x - gb.x, hb.y - gb.y).toFixed(2)} px apart)`);
});

test('the guest\'s charges are fired in the host\'s game, and the guest sees them', () => {
  let seen = 0;
  const r = play(level(1), 4, busy, undefined, {
    each: (host, guest) => {
      if (guest.charges.some((c) => c.owner === 1)) seen++;
    },
  });
  assert.ok(r.host.tally.shots >= 5, `${r.host.tally.shots} shots in the host's game`);
  assert.ok(seen > 30, 'and on the guest\'s screen');
});

test('the host\'s robot, the enemies and the pickups follow the host on the guest\'s screen', () => {
  const r = play(level(1), 8, () => IDLE, busy);
  const hb = r.host.players[0].bot;
  const gb = r.guest.players[0].bot;
  assert.ok(Math.hypot(hb.x - gb.x, hb.y - gb.y) < 1, 'the other robot is where the host has it');
  const live = (g) => g.enemies.filter((e) => !e.dead && e.awake).map((e) => e.id).sort();
  assert.deepEqual(live(r.guest), live(r.host), 'the same enemies awake');
  for (const e of r.host.enemies.filter((x) => x.awake)) {
    const m = r.guest.enemies.find((x) => x.id === e.id);
    assert.ok(m && Math.hypot(m.x - e.x, m.y - e.y) < 3, `enemy ${e.id} where the host has it`);
  }
  assert.deepEqual(r.guest.pickups.map((p) => p.id).sort(), r.host.pickups.map((p) => p.id).sort(), 'the same pickups lying about');
  assert.equal(r.guest.world.crates.filter((c) => c.broken).length, r.host.world.crates.filter((c) => c.broken).length, 'the same crates broken');
  assert.ok(r.guest.fx.parts.length + r.guest.fx.rings.length >= 0);
});

test('what the host hears, the guest hears: the sounds of the host\'s play come through', () => {
  const heard = [];
  play(level(1), 6, () => IDLE, busy, {
    each: (host, guest) => {
      heard.push(...guest.events.map((e) => e.s));
      guest.events.length = 0;
    },
  });
  assert.ok(heard.includes('fire'), 'the host\'s shots');
  assert.ok(heard.filter((s) => s === 'fire').length < 20, 'each once, not once for every snapshot it was repeated in');
});

test('a guest\'s wormhole ends open in the host\'s game and the guest goes through them', () => {
  const bp = arenaMap('spires');
  // The guest stands by the left tower, opens an end on it, and one on the far tower's face.
  const steps = (t) => {
    if (t < 0.2) return { mx: 0, aim: 0 };
    if (t < 0.22) return { mx: 0, aim: 0, worm: [true, false] };
    if (t < 0.4) return { mx: 0, aim: Math.PI };
    if (t < 0.42) return { mx: 0, aim: Math.PI, worm: [false, true] };
    return { mx: t < 1.6 ? 1 : 0, aim: 0 };
  };
  const r = play(bp, 2.5, steps, () => IDLE, {
    mode: 'versus',
    setup: (g) => {
      g.phase = 'play';
      g.players[1].bot.spawn(1100, -31);
      g.players[0].bot.spawn(140, -31);
    },
  });
  const pair = r.host.world.portals[1];
  assert.ok(pair[0] && pair[1], 'both ends open in the host\'s game');
  assert.ok(r.guest.world.portals[1][0] && r.guest.world.portals[1][1], 'and in the guest\'s');
  const hb = r.host.players[1].bot;
  const gb = r.guest.players[1].bot;
  assert.ok(Math.hypot(hb.x - gb.x, hb.y - gb.y) < 1, 'the robot is in the same place on both after going through');
});

test('versus: a hit on the guest is the host\'s to call, and the guest\'s screen shows its shields go', () => {
  const r = play(arenaMap('crossfire'), 3, () => IDLE, (t) => ({ mx: 0, aim: 0, fire: t % 0.5 < 1 / 120 }), {
    mode: 'versus',
    setup: (g) => {
      g.phase = 'play';
      g.players[0].bot.spawn(600, -31);
      g.players[1].bot.spawn(900, -31);
    },
  });
  const lost = 99 - r.host.players[1].pool;
  assert.ok(lost >= 1, `the guest lost ${lost}`);
  assert.equal(r.guest.players[1].pool, r.host.players[1].pool, 'and sees it');
});

test('snapshots stay small enough to send thirty times a second', () => {
  const r = play(level(1), 6, busy, busy);
  const max = Math.max(...r.sizes);
  const mean = r.sizes.reduce((a, b) => a + b, 0) / r.sizes.length;
  assert.ok(max < 16000 && mean < 8000, `mean ${Math.round(mean)} bytes, largest ${max}`);
  assert.equal(NET.snapHz, 30);
  assert.equal(MSG.snap, 'dxS');
});

/** A 2D context that does nothing, for drawing without a page. */
function nullContext() {
  const grad = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
}

test('every boss fight comes through to a guest whole: the boss where the host has it, and drawn from what was sent', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const A = bp.arena;
    const trail = []; // where the host's boss has been: the guest shows it a moment behind
    const r = play(bp, 5, () => IDLE, () => IDLE, {
      setup: (g) => {
        for (const e of g.enemies) e.dead = true;
        g.players[0].bot.spawn(A.x0 + 200, A.floor - 31);
        g.players[1].bot.spawn(A.x0 + 260, A.floor - 31);
      },
      each: (host, guest, now) => host.boss && trail.push({ now, x: host.boss.x, y: host.boss.y }),
    });
    const hb = r.host.boss;
    const gb = r.guest.boss;
    assert.ok(hb && gb, `${L.title}: a boss on both`);
    assert.equal(gb.id, BOSS_ORDER[L.id - 1]);
    const off = Math.min(...trail.slice(-30).map((p) => Math.hypot(p.x - gb.x, p.y - gb.y)));
    assert.ok(off < 12, `${L.title}: the boss where the host had it a moment ago (${Math.round(off)} px off its path)`);
    assert.equal(gb.parts.length, hb.parts.length, `${L.title}: all its parts`);
    const ctx = nullContext();
    assert.doesNotThrow(() => drawBoss(ctx, gb, 5, 1, r.guest.phase, false), `${L.title}: drawn`);
    for (const e of r.guest.enemies) assert.doesNotThrow(() => drawEnemy(ctx, e, 5, 1, false));
    for (const p of r.guest.players) assert.doesNotThrow(() => drawRobot(ctx, p.bot, 5, 1, {}));
  }
});
