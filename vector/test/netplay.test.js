// Vector's netcode, run between a host and a guest in one process over a
// pretend network (every message through JSON, late by a changing amount, and
// some lost): the guest's own robot agrees with the host's, through lifts,
// crushers and wormholes; its look stays its own; its charges and wormhole
// ends happen in the host's game; everything else follows the host; and
// every boss fight comes through whole and draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, IDLE } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { arenaMap } from '../src/maps.js';
import { HostLink, HostQueue, GuestInputs, Mirror, packIntent, unpackIntent, recordStep, PRESSES, MSG } from '../src/netplay.js';
import { PHYSICS_DT, VERSUS } from '../src/config.js';
import { Art } from '../src/art.js';
import { FX } from '../src/fx.js';
import { Autopilot } from '../tools/autopilot.mjs';

const DT = PHYSICS_DT;

test('an intent packs into six numbers and back, and a press is only on the first step of a record', () => {
  const it = { mx: -0.5, mz: 1, run: true, jump: true, jumpPress: true, fire: false, firePress: true, worm: [false, true], cycle: -1, pick: 3, yaw: 1.23456, pitch: -0.2, turns: 4 };
  const back = unpackIntent(...packIntent(it));
  assert.deepEqual(back, { ...it, yaw: 1.2346 });
  for (let pick = 0; pick < 6; pick++) for (const cycle of [1, 0, -1]) {
    const b = unpackIntent(...packIntent({ mx: 0, mz: 0, cycle, pick, yaw: 0 }));
    assert.ok(b.pick === pick && b.cycle === cycle, `a pick of ${pick} and a cycle of ${cycle} come through`);
  }
  const [mx, mz, bits, yaw, pitch, turns] = packIntent(it);
  const rec = [7, 3, mx, mz, bits, yaw, pitch, turns];
  assert.ok(recordStep(rec, 0).firePress && recordStep(rec, 0).jumpPress && recordStep(rec, 0).worm[1]);
  for (const i of [1, 2]) {
    const s = recordStep(rec, i);
    assert.ok(!s.firePress && !s.jumpPress && !s.worm[1] && !s.cycle && s.pick == null, 'no presses after the first step');
    assert.ok(s.jump && s.run && s.mx === -0.5 && s.yaw === 1.2346, 'but what is held stays held, and the look stays');
  }
  assert.equal(bits & PRESSES, bits & ~(1 | 2));
});

test('the host plays a guest\'s records in order, each for its steps, waits when they run dry, and acks what it has played', () => {
  const q = new HostQueue();
  assert.deepEqual(q.next(), [], 'nothing yet: the robot waits');
  q.push([[1, 4, 1, 0, 0, 0, 0, 1], [2, 4, -1, 0, 16, 0, 0, 1]]);
  const played = [];
  for (let i = 0; i < 8; i++) played.push(...q.next());
  assert.equal(played.length, 8);
  assert.ok(played.slice(0, 4).every((it) => it.mx === 1));
  assert.ok(played[4].firePress && played.slice(5).every((it) => it.mx === -1 && !it.firePress), 'a press once, on its record\'s first step');
  assert.deepEqual(q.ackPair(), [2, 0]);
  q.push([[1, 4, 1, 0, 0, 0, 0, 1], [2, 4, -1, 0, 16, 0, 0, 1]]);
  assert.equal(q.depth, 0, 'a repeated record is not played twice');
  assert.deepEqual(q.next(), [], 'dry: it waits');
});

test('a match drops what is left over from the one before', () => {
  const bp = arenaMap('crossfire');
  const host = new Game(bp, { mode: 'versus', players: 2, local: 0 });
  host.phase = 'fight';
  const hl = new HostLink(host, 2);
  // The old match's guest was up to record 331; the new one starts again from 1.
  hl.input(1, { t: MSG.input, m: 1, r: [[331, 4, 1, 0, 0, 0, 0, 1]] });
  const fresh = new GuestInputs(2);
  const x = host.players[1].bot.pos[0];
  for (let k = 0; k < 30; k++) {
    fresh.record({ mx: 1, yaw: 0, pitch: 0, turns: host.players[1].bot.turns }, 2);
    const m = fresh.message();
    assert.equal(m.m, 2, 'each input says which match it is for');
    hl.input(1, JSON.parse(JSON.stringify(m)));
    for (let s = 0; s < 2; s++) host.step(DT, hl.intents(IDLE));
  }
  assert.ok(Math.abs(host.players[1].bot.pos[0] - x) > 1, 'the guest\'s robot moves in the new match');
  const s = hl.snapshot();
  assert.equal(s.m, 2);
  const mirror = new Mirror(new Game(arenaMap('crossfire'), { mode: 'versus', players: 2, local: 1 }), 1, 3);
  assert.equal(mirror.receive(JSON.parse(JSON.stringify(s)), 0), false, 'and a guest in another match takes no snapshot of this one');
});

/** A pretend network: late by 40 to 90 ms each way, and one message in twenty lost. */
function link(seed) {
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
 * A host and a guest playing a blueprint made by `make` for up to `seconds`,
 * the guest's robot doing what `guestPlays(t, guestGame)` says (its look
 * included) and the host's what `hostPlays(t)` says. Runs at 60 frames a
 * second, two physics steps each; the host snapshots every other frame.
 * Stops early when `opts.until(host, guest)` says so, then gives the
 * network a second to catch up with nobody pressing anything.
 */
function play(make, seconds, guestPlays, hostPlays = () => IDLE, opts = {}) {
  const mode = opts.mode || 'coop';
  const o = { mode, players: 2, shields: 99, maxShields: 99, rng: () => 0.4, ...(opts.game || {}) };
  const host = new Game(make(), { ...o, local: 0 });
  const guest = new Game(make(), { ...o, local: 1 });
  if (opts.setup) {
    opts.setup(host);
    opts.setup(guest);
  }
  const hl = new HostLink(host);
  const mirror = new Mirror(guest, 1);
  const inputs = new GuestInputs();
  const up = link(11);
  const down = link(23);
  let now = 0;
  let frame = 0;
  const sizes = [];
  const moved = []; // every correction the host's word made to the guest's robot, and when
  const tick = (git, hit) => {
    now += 1 / 60;
    frame++;
    const b = guest.bot;
    const rec = inputs.record({ ...git, yaw: git.yaw ?? b.yaw, pitch: git.pitch ?? b.pitch, turns: b.turns }, 2);
    if (rec) mirror.predict(rec);
    up.send(inputs.message(), now);
    for (const m of up.take(now)) hl.input(1, m);
    for (let k = 0; k < 2; k++) host.step(DT, hl.intents(k === 0 ? hit : { ...hit, jumpPress: false, firePress: false, worm: [false, false], cycle: 0, pick: null }));
    hl.events(host.events);
    host.events.length = 0;
    if (frame % 2 === 0) {
      const s = hl.snapshot();
      sizes.push(JSON.stringify(s).length);
      down.send(s, now);
    }
    for (const m of down.take(now)) {
      const n = mirror.corrections.length;
      if (mirror.receive(m, now) && mirror.corrections.length > n) moved.push({ d: mirror.corrections[mirror.corrections.length - 1], phase: host.phase, t: now });
    }
    mirror.show(now);
    mirror.fade(1 / 60);
    guest.events.length = 0;
  };
  for (let t = 0; t < seconds; t += 1 / 60) {
    tick(guestPlays(t, guest), hostPlays(t));
    if (opts.until && opts.until(host, guest)) break;
  }
  for (let t = 0; t < 1; t += 1 / 60) tick(IDLE, IDLE);
  return { host, guest, mirror, hl, sizes, moved };
}

const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('the guest\'s own robot agrees with the host\'s to under a centimetre, running, jumping and turning', () => {
  const r = play(() => arenaMap('crossfire'), 10, (t, g) => ({ mz: 1, mx: Math.sin(t * 1.3) * 0.6, run: t > 2, jump: t % 1.7 < 0.4, jumpPress: t % 1.7 < 0.017, yaw: g.bot.yaw + 0.012 }), undefined, { mode: 'versus', setup: (g) => (g.phase = 'fight') });
  assert.ok(apart(r.host.players[1].bot.pos, r.guest.players[1].bot.pos) < 0.01, 'where it ends up');
  const worst = Math.max(...r.moved.map((m) => m.d));
  assert.ok(worst < 0.01, `and every correction on the way (${worst.toFixed(4)} m)`);
  assert.ok(r.moved.length > 200, 'over a few hundred snapshots');
  assert.ok(Math.max(...r.sizes) < 4000, `a snapshot is small (${Math.max(...r.sizes)} bytes)`);
});

test('riding lifts, timing a crusher and a laser gate as a guest, the robot agrees with the host\'s', () => {
  // The Foundry's tour, flown by the autopilot on the guest's own copy of the arena, from the guest's spawn.
  let ap = null;
  const r = play(() => arenaMap('foundry'), 90, (t, g) => {
    if (!ap) {
      ap = new Autopilot(g);
      const sp = g.bp.spawns[1];
      const k = ap.route.findIndex((st) => st.to && Math.hypot(st.to[0] - sp.p[0], st.to[2] - sp.p[2]) < 0.5);
      ap.route = [...ap.route.slice(k + 1), ...ap.route.slice(0, k + 1)];
    }
    if (ap.done || ap.failed) return IDLE;
    const it = ap.intent();
    return { ...it, yaw: g.bot.yaw, pitch: g.bot.pitch };
  }, undefined, { mode: 'versus', setup: (g) => (g.phase = 'fight'), until: () => ap && (ap.done || ap.failed) });
  assert.ok(ap.done && !ap.failed, `the tour is flown: ${ap.failed || ''}`);
  assert.equal(r.host.players[1].stats.lost, 0, 'without a shield lost in the host\'s game');
  assert.ok(apart(r.host.players[1].bot.pos, r.guest.players[1].bot.pos) < 0.01);
  const worst = Math.max(...r.moved.map((m) => m.d));
  assert.ok(worst < 0.05, `corrections stay small (${worst.toFixed(4)} m)`);
});

test('through a wormhole: the guest opens its pair and walks through, turned, where the host has it', () => {
  let warps = 0;
  const r = play(() => arenaMap('crossfire'), 6, (t, g) => {
    const b = g.bot;
    if (t < 0.5) return { yaw: 0, pitch: 0 };
    if (t < 0.52) return { yaw: 0, pitch: -0.1, worm: [true, false] };
    if (t < 1.0) return { yaw: -Math.PI / 2, pitch: 0 };
    if (t < 1.02) return { yaw: -Math.PI / 2, pitch: -0.1, worm: [false, true] };
    if (t < 1.5) return { yaw: 0, pitch: 0 };
    return { mz: 1, yaw: b.yaw, pitch: b.pitch };
  }, undefined, { mode: 'versus', setup: (g) => (g.phase = 'fight') });
  warps = r.host.warps;
  const hb = r.host.players[1].bot;
  const gb = r.guest.players[1].bot;
  assert.ok(r.host.players[1].ends[0] && r.host.players[1].ends[1], 'the guest\'s ends open in the host\'s game');
  assert.ok(warps >= 1 && r.guest.warps >= 1, 'it went through, in both');
  assert.ok(Math.abs(gb.yaw - Math.PI / 2) < 0.05, 'turned the way the far end faces');
  assert.ok(apart(hb.pos, gb.pos) < 0.01 && Math.abs(hb.yaw - gb.yaw) < 1e-3, 'where, and facing the way, the host has it');
  assert.ok(Math.max(...r.moved.map((m) => m.d)) < 0.01, 'with no correction on the way');
});

test('the guest\'s look is its own: the host never turns it, but a respawn does', () => {
  let turned = null;
  const r = play(() => arenaMap('horizon'), 5, (t, g) => {
    // Turn steadily; walk off the corner into the pit a little way in.
    const b = g.bot;
    if (t < 2) return { yaw: b.yaw + 0.02, pitch: 0.1 };
    if (turned == null) turned = b.yaw;
    return { mz: 1, run: true, yaw: Math.atan2(-b.pos[0], -b.pos[2]), pitch: 0 };
  }, undefined, { mode: 'versus', setup: (g) => (g.phase = 'fight') });
  const hb = r.host.players[1].bot;
  const gb = r.guest.players[1].bot;
  assert.ok(r.host.players[1].stats.lost >= 1, 'the pit took a shield');
  assert.ok(apart(hb.pos, gb.pos) < 0.01, 'and the guest\'s robot is back at the spawn with the host\'s');
  assert.ok(Math.abs(hb.yaw - gb.yaw) < 1e-3, 'facing the way the respawn put it');
});

test('co-op: the guest crosses levels as the host sees it, doors, switches, wormholes and all', () => {
  for (const id of [2, 5, 8]) {
    let ap = null;
    const r = play(() => level(id, { noEnemies: true }), 240, (t, g) => {
      if (!ap) ap = new Autopilot(g);
      if (ap.done || ap.failed) return IDLE;
      const it = ap.intent();
      if (g.phase === 'boss') ap.done = true;
      return { ...it, yaw: g.bot.yaw, pitch: g.bot.pitch };
    }, undefined, { game: { noWaves: true }, until: (h) => h.phase === 'boss' });
    const L = LEVEL_DEFS[id - 1];
    assert.ok(!ap.failed, `${L.title}: ${ap.failed}`);
    assert.equal(r.host.phase, 'boss', `${L.title}: the guest walked into the boss's arena in the host's game`);
    assert.equal(r.host.players[1].stats.lost, 0, `${L.title}: no shield lost in the host's game`);
    const before = r.moved.filter((m) => m.phase !== 'boss');
    const worst = Math.max(...before.map((m) => m.d));
    assert.ok(worst < 0.05, `${L.title}: corrections stay small on the way (${worst.toFixed(4)} m)`);
  }
});

test('a guest\'s shots happen in the host\'s game, and everything else follows the host', () => {
  const r = play(() => arenaMap('yard'), 4, (t) => ({ firePress: Math.abs(t - 0.5) < 0.01 || Math.abs(t - 1.5) < 0.01, yaw: Math.PI, pitch: 0.05 }), (t) => ({ mz: 1, mx: Math.cos(t), yaw: t }), { mode: 'versus', setup: (g) => (g.phase = 'fight') });
  assert.equal(r.host.players[1].stats.shots, 2, 'the guest\'s two shots were fired in the host\'s game');
  // After the network settles, the guest sees the host's robot where the host has it.
  assert.ok(apart(r.host.players[0].bot.pos, r.guest.players[0].bot.pos) < 0.05, 'the other robot, where the host has it');
  assert.deepEqual(r.guest.players.map((p) => p.shields), r.host.players.map((p) => p.shields));
});

test('every boss fight comes through whole to the guest, and draws', () => {
  const art = new Art({ draw: (s, m) => m.forEach((v) => assert.ok(Number.isFinite(v))), point: (p) => assert.ok(p.every(Number.isFinite)), light() {} });
  const fx = new FX();
  for (const L of LEVEL_DEFS) {
    const r = play(() => level(L.id, { noEnemies: true }), 6, (t, g) => ({ yaw: g.bot.yaw, pitch: 0.1 }), (t) => ({ firePress: t % 0.5 < 0.017 }), {
      game: { invulnerable: true },
      setup: (g) => {
        const A = g.bp.arena;
        g.players.forEach((p) => p.bot.spawn(A.spawn, A.yaw));
        g.startBoss();
      },
    });
    const hb = r.host.boss;
    const gb = r.guest.boss;
    assert.ok(gb && gb.id === hb.id, `${L.title}: the guest has the boss`);
    assert.equal(gb.hp, hb.hp, `${L.title}: as hurt as the host's`);
    assert.equal(gb.parts.length, hb.parts.length, `${L.title}: every part of it`);
    // Shown a tenth of a second behind: as far off as it moves in that, and a little.
    const speed = hb.vel ? Math.hypot(...hb.vel) : 0;
    assert.ok(apart(gb.pos, hb.pos) < 0.5 + speed * 0.15, `${L.title}: where the host has it`);
    art.lastEye = r.guest.bot.eyePos();
    art.frame(r.guest, fx, { time: 6, aimLine: true, eye: r.guest.bot.eyePos() });
    art.viewmodel({ draw: () => {} }, r.guest);
    assert.ok(Math.max(...r.sizes) < 20000, `${L.title}: snapshots stay small (${Math.max(...r.sizes)} bytes)`);
  }
});

test('versus over the wire: a guest hit by the host is hurt and put back at a spawn on both screens', () => {
  const r = play(() => arenaMap('crossfire'), 4, () => ({ yaw: Math.PI, pitch: 0 }), (t) => ({ firePress: Math.abs(t - 0.3) < 0.01 }), {
    mode: 'versus',
    setup: (g) => {
      g.phase = 'fight';
      g.players[0].bot.spawn([0, 0.91, 12], Math.PI);
      g.players[1].bot.spawn([0, 0.91, 6], 0);
    },
  });
  assert.equal(r.host.players[1].shields, 98, 'the host\'s shot took one of the guest\'s shields');
  assert.equal(r.guest.players[1].shields, 98, 'and the guest knows it');
  assert.ok(r.host.bp.spawns.some((s) => apart(s.p, r.guest.players[1].bot.pos) < 0.5), 'its robot back at a spawn');
  assert.ok(VERSUS.hammer === 2);
});
