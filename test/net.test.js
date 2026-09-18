import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGameState, rebuildWalls } from '../src/gamestate.js';
import { buildSnapshot, applySnapshot, noteArrival, bufferFor, advanceRenderClock, INTERP_MIN, INTERP_MAX, EXTRAPOLATE_MAX } from '../src/netstate.js';
import { LEVELS } from '../src/levels.js';

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (waiters.length) waiters.shift()(msg);
      else queue.push(msg);
    };
    ws.onopen = () => resolve({ ws, next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))), send: (o) => ws.send(JSON.stringify(o)) });
    ws.onerror = () => reject(new Error('connect failed'));
  });
}

test('relay: create, join, forward both ways, and leave', async () => {
  const port = 18080 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['server.js', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(server.stdout, 'data');
  try {
    const lan = await (await fetch(`http://127.0.0.1:${port}/lan`)).json();
    assert.equal(lan.port, port);
    assert.ok(Array.isArray(lan.addresses));

    const host = await openSocket(port);
    host.send({ t: 'create', name: 'Ann' });
    const created = await host.next();
    assert.equal(created.t, 'created');
    assert.match(created.code, /^[A-Z0-9]{4}$/);

    const stranger = await openSocket(port);
    stranger.send({ t: 'join', code: 'ZZZZ', name: 'Nobody' });
    const err = await stranger.next();
    assert.equal(err.t, 'error');

    const guest = await openSocket(port);
    guest.send({ t: 'join', code: created.code.toLowerCase(), name: 'Bob' });
    const joined = await guest.next();
    assert.equal(joined.t, 'joined');
    assert.equal(joined.peerName, 'Ann');
    const peer = await host.next();
    assert.equal(peer.t, 'peer');
    assert.equal(peer.name, 'Bob');

    // A second friend is welcome (rooms hold two guests); a third is refused.
    stranger.send({ t: 'join', code: created.code, name: 'Nobody' });
    const second = await stranger.next();
    assert.equal(second.t, 'joined');
    assert.equal(second.id, 'd');
    assert.equal((await host.next()).t, 'peer');
    assert.equal((await guest.next()).t, 'peer');
    stranger.send({ t: 'leave' });
    assert.equal((await host.next()).t, 'peer-left');
    assert.equal((await guest.next()).t, 'peer-left');
    const fourth = await openSocket(port);
    const filler = await openSocket(port);
    filler.send({ t: 'join', code: created.code, name: 'Filler' });
    assert.equal((await filler.next()).t, 'joined');
    await host.next();
    await guest.next();
    fourth.send({ t: 'join', code: created.code, name: 'Fourth' });
    assert.equal((await fourth.next()).msg, 'That room is full');
    fourth.ws.close();

    // Relay both directions, payload untouched (the host's messages reach every guest).
    host.send({ t: 's', ball: [1.5, 2, 3, 4, 0], f: [], mv: [] });
    const snap = await guest.next();
    assert.deepEqual(snap.ball, [1.5, 2, 3, 4, 0]);
    assert.deepEqual((await filler.next()).ball, [1.5, 2, 3, 4, 0]);
    guest.send({ t: 'i', mx: 0.5, my: -1, turn: 1, lunge: 1, retract: 0 });
    const intent = await host.next();
    assert.equal(intent.mx, 0.5);

    // Ping round trip.
    guest.send({ t: 'ping', ts: 42 });
    const ping = await host.next();
    assert.equal(ping.t, 'ping');
    host.send({ t: 'pong', ts: ping.ts });
    assert.equal((await guest.next()).t, 'pong');
    assert.equal((await filler.next()).t, 'pong'); // fan-out reaches the other guest too

    // Guest leaving tells the host (and the other guest), naming who.
    guest.ws.close();
    const left = await host.next();
    assert.equal(left.t, 'peer-left');
    assert.equal(left.id, 'c');
    assert.equal((await filler.next()).id, 'c');
    host.ws.close();
    filler.ws.close();
    stranger.ws.close();
  } finally {
    server.kill();
  }
});

test('snapshot round trip mirrors ball, fighters, movers, glass and ice', () => {
  for (const def of LEVELS) {
    const src = createGameState(def, { pvp: true });
    const dst = createGameState(def, { pvp: true });
    src.ball.x = 123.4;
    src.ball.y = 456.7;
    src.ball.vx = -321.9;
    src.ball.vy = 12.3;
    src.ball.held = false;
    src.player.x = 300.5;
    src.player.angle = 1.234;
    src.player.paddleOffset = 50;
    src.player.frozen = 1.5;
    src.boss.lungeState = 'out';
    for (const m of src.movers) m.update(1.37);
    if (src.panes.length) {
      src.panes[0].broken = true;
      src.panes[0].regrowAt = 9.5;
      for (const sg of src.panes[0].segs) sg.broken = true;
      rebuildWalls(src);
    }
    if (src.ice) {
      src.ice.start(3);
      src.ice.update(3.1, { x: 10, y: 20 });
      src.ice.update(3.2, { x: 40, y: 20 });
    }
    src.time = 7.75;
    const snap = JSON.parse(JSON.stringify(buildSnapshot(src, { st: 'playing', cd: 0, sc: { host: 1, guest: 2 }, rd: 3, w: null }, [{ e: 'whack' }], true)));
    assert.equal(snap.t, 's');
    assert.equal(snap.st, 'playing');
    assert.deepEqual(snap.ev, [{ e: 'whack' }]);
    applySnapshot(dst, snap);
    assert.ok(Math.abs(dst.ball.x - 123.4) < 0.06 && Math.abs(dst.ball.vx - -321.9) < 0.06);
    assert.equal(dst.ball.held, false);
    assert.ok(Math.abs(dst.player.angle - 1.234) < 1e-3);
    assert.equal(dst.player.frozen, 1.5);
    assert.equal(dst.boss.lungeState, 'out');
    for (let i = 0; i < src.movers.length; i++) {
      const a = src.movers[i].segments()[0];
      const b = dst.movers[i].segments()[0];
      assert.ok(Math.hypot(a.ax - b.ax, a.ay - b.ay) < 1, `mover ${i} of level ${def.id} mirrored`);
    }
    if (src.panes.length) {
      assert.equal(dst.panes[0].broken, true);
      assert.equal(dst.walls.length, src.walls.length, 'wall list rebuilt to match');
    }
    if (src.ice) assert.equal(dst.ice.points.length, src.ice.points.length);
    assert.ok(Math.abs(dst.time - 7.75) < 0.06, 'time mirrored to a tenth');
  }
});

test('relay: a room takes two guests with ids, fans the host out to both, and reports who left', async () => {
  const port = 19080 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['server.js', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(server.stdout, 'data');
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.ok, true);
    assert.ok(health.v >= 2, 'protocol version reported');

    const host = await openSocket(port);
    host.send({ t: 'create', name: 'Ann' });
    const created = await host.next();
    const code = created.code;

    const bob = await openSocket(port);
    bob.send({ t: 'join', code, name: 'Bob' });
    const joinedB = await bob.next();
    assert.equal(joinedB.t, 'joined');
    assert.equal(joinedB.id, 'c');
    assert.deepEqual(joinedB.peers, []);
    const peerB = await host.next();
    assert.deepEqual([peerB.t, peerB.id, peerB.name], ['peer', 'c', 'Bob']);

    const cid = await openSocket(port);
    cid.send({ t: 'join', code, name: 'Cid' });
    const joinedC = await cid.next();
    assert.equal(joinedC.id, 'd');
    assert.deepEqual(joinedC.peers, [{ id: 'c', name: 'Bob' }]);
    const peerC = await host.next();
    assert.deepEqual([peerC.id, peerC.name], ['d', 'Cid']);
    const bobSeesCid = await bob.next();
    assert.deepEqual([bobSeesCid.t, bobSeesCid.id], ['peer', 'd']);

    const late = await openSocket(port);
    late.send({ t: 'join', code, name: 'Dee' });
    assert.equal((await late.next()).msg, 'That room is full');

    host.send({ t: 's', n: 1 });
    assert.deepEqual(await bob.next(), { t: 's', n: 1 });
    assert.deepEqual(await cid.next(), { t: 's', n: 1 });
    bob.send({ t: 'i', id: 'c', mx: 1 });
    cid.send({ t: 'i', id: 'd', mx: -1 });
    const got = [await host.next(), await host.next()].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(got, [{ t: 'i', id: 'c', mx: 1 }, { t: 'i', id: 'd', mx: -1 }]);

    bob.send({ t: 'leave' });
    const leftH = await host.next();
    assert.deepEqual([leftH.t, leftH.id, leftH.name], ['peer-left', 'c', 'Bob']);
    const leftC = await cid.next();
    assert.deepEqual([leftC.t, leftC.id], ['peer-left', 'c']);
    // The freed id is handed to the next joiner.
    late.send({ t: 'join', code, name: 'Dee' });
    assert.equal((await late.next()).id, 'c');
    await host.next();
    await cid.next();

    host.ws.close();
    for (const g of [cid, late]) assert.deepEqual([(await g.next()).t, 'a'], ['peer-left', 'a']);
    for (const c of [host, bob, cid, late]) c.ws.close();
  } finally {
    server.kill();
  }
});

test('link stats: a steady link has no jitter, a swinging one does, and the label reads as the HUD shows it', async () => {
  const { LinkStats } = await import('../src/net.js');
  const steady = new LinkStats();
  for (let i = 0; i < 20; i++) steady.add(80);
  assert.equal(Math.round(steady.mean), 80);
  assert.equal(Math.round(steady.jitter), 0);
  assert.equal(steady.label, '80 ms ±0');
  const swinging = new LinkStats();
  for (let i = 0; i < 40; i++) swinging.add(i % 2 ? 100 : 60);
  assert.ok(Math.abs(swinging.mean - 80) < 6, `mean settles near 80: ${swinging.mean}`);
  assert.ok(swinging.jitter > 12, `jitter shows the swing: ${swinging.jitter}`);
  const fresh = new LinkStats();
  assert.equal(fresh.label, '—');
  fresh.add(-5);
  fresh.add(NaN);
  assert.equal(fresh.samples, 0, 'nonsense is ignored');
});

test('relay: a ping for the relay itself is answered by the relay and never forwarded', async () => {
  const port = 19080 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['server.js', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(server.stdout, 'data');
  try {
    const host = await openSocket(port);
    host.send({ t: 'create', name: 'Ann' });
    const created = await host.next();
    const guest = await openSocket(port);
    guest.send({ t: 'join', code: created.code, name: 'Bo' });
    assert.equal((await guest.next()).t, 'joined');
    assert.equal((await host.next()).t, 'peer');
    guest.send({ t: 'rping', ts: 1234.5 });
    const pong = await guest.next();
    assert.deepEqual(pong, { t: 'rpong', ts: 1234.5 }, 'the relay answers for itself');
    // The host hears nothing of it: the next thing it gets is what the guest sends after.
    guest.send({ t: 'i', id: 'c', seq: 1, mx: 0, my: 0, turn: 0, lunge: 0, retract: 0, lag: 60 });
    const heard = await host.next();
    assert.equal(heard.t, 'i', `the host's next message is the input, not the ping (${heard.t})`);
    assert.equal(heard.lag, 60, 'and the input carries the guest\'s view lag');
    // A peer ping still goes to the other side, and its answer names who answered.
    host.send({ t: 'ping', ts: 7 });
    const ping = await guest.next();
    assert.equal(ping.t, 'ping');
    guest.send({ t: 'pong', ts: ping.ts, id: 'c' });
    const answer = await host.next();
    assert.equal(answer.t, 'pong');
    assert.equal(answer.id, 'c');
    host.ws.close();
    guest.ws.close();
  } finally {
    server.kill();
  }
});

test('render buffer: a view between two snapshots, the guest\'s own fighter left alone, and nothing outside the bracket', async () => {
  const { bracket, lerpView } = await import('../src/netstate.js');
  const def = LEVELS[0];
  const g = createGameState(def, { pvp: true });
  const snap = (time, bx, by, fx, angle) => ({ time, s: buildSnapshot({ ...g, ball: { ...g.ball, x: bx, y: by, vx: 100, vy: 0, held: false }, fighters: g.fighters.map((f, i) => (i === 1 ? { ...f, x: fx, angle, paddleOffset: f.paddleOffset } : f)) }, { st: 'playing' }, [], false) });
  // buildSnapshot reads fighter methods through the spread; give the fakes what it needs.
  const a = { time: 1.0, s: { ball: [100, 200, 100, 0, 0], f: [[300, 450, 0, 36], [1200, 450, 3.0, 36]], mv: [] } };
  const b = { time: 1.05, s: { ball: [110, 200, 100, 0, 0], f: [[320, 450, 0, 36], [1180, 470, -3.0, 40]], mv: [] } };
  void snap;
  const buf = [a, b];
  assert.equal(bracket(buf, 0.9), null, 'before the first snapshot');
  assert.equal(bracket(buf, 1.1), null, 'past the newest');
  const br = bracket(buf, 1.025);
  assert.ok(br && br.a === a && br.b === b && Math.abs(br.u - 0.5) < 1e-9);
  g.fighters[0].x = 999; // the guest's own fighter, predicted: the view must not touch it
  lerpView(g, a, b, 0.5, 'a');
  assert.equal(g.ball.x, 105);
  assert.equal(g.fighters[0].x, 999, 'skipSlot is left alone');
  assert.equal(g.fighters[1].x, 1190);
  assert.equal(g.fighters[1].y, 460);
  assert.equal(g.fighters[1].paddleOffset, 38);
  // Angles interpolate the short way round: from 3.0 to -3.0 is 0.28 rad through pi, not 6 rad back through 0.
  assert.ok(Math.abs(Math.abs(g.fighters[1].angle) - Math.PI) < 0.15, `the short way round: ${g.fighters[1].angle}`);
});

test('latency compensation: a shield that would have met the ball the guest saw is played, one the ball was leaving is not', async () => {
  const { rewoundContact, usableLag, MAX_LAG } = await import('../src/lagcomp.js');
  const { Fighter } = await import('../src/entities.js');
  const f = new Fighter({ x: 500, y: 450, angle: 0, paddleBase: 36, paddleThick: 6, paddleWidth: 116 });
  const seg = f.paddleSegment();
  const face = Math.min(seg.ax, seg.bx); // the shield stands upright, its face this far along x
  // The ball as the guest saw it: just short of the face and closing on it.
  const hit = rewoundContact({ x: face - 8, y: 450, vx: 300, vy: 0 }, f, 11);
  assert.ok(hit, 'a closing ball meets the shield');
  assert.ok(hit.nx < 0, 'and the contact pushes it back the way it came');
  // The same spot, moving away: no contact is played.
  assert.equal(rewoundContact({ x: face - 8, y: 450, vx: -300, vy: 0 }, f, 11), null);
  // Well past the shield: nothing.
  assert.equal(rewoundContact({ x: face + 200, y: 450, vx: 300, vy: 0 }, f, 11), null);
  // How much lag the host honours: nothing under a couple of steps, and never more than a quarter second.
  assert.equal(usableLag(10), 0);
  assert.equal(usableLag(60), 0.06);
  assert.equal(usableLag(900), MAX_LAG);
  assert.equal(usableLag('junk'), 0);
});

test('render clock: arrivals set a smoothed host clock, a late packet raises the buffer and it fades back', () => {
  let c = null;
  // Sixty snapshots a second, each arriving 100 ms after its host time, dead steady.
  for (let i = 0; i < 120; i++) c = noteArrival(c, i / 60, 100 + (i / 60) * 1000);
  assert.ok(Math.abs(c.off - 100) < 1e-6);
  assert.ok(c.peak < 1e-6);
  assert.ok(Math.abs(c.gap - 1 / 60) < 1e-6);
  assert.ok(bufferFor(c) >= INTERP_MIN && bufferFor(c) < 0.05); // two gaps and a little: the floor
  // One packet 150 ms late: the buffer opens up to cover it, and the clock barely moves.
  c = noteArrival(c, 2, 100 + 2000 + 150);
  assert.ok(c.peak > 140);
  assert.ok(c.off < 104);
  const opened = bufferFor(c);
  assert.ok(opened > 0.15 && opened <= INTERP_MAX);
  // Steady again for three seconds: the worst lateness fades and the buffer closes.
  for (let i = 121; i < 300; i++) c = noteArrival(c, i / 60, 100 + (i / 60) * 1000);
  assert.ok(bufferFor(c) < opened);
  // An early packet costs nothing: the buffer covers lateness alone.
  const peakBefore = c.peak;
  c = noteArrival(c, 5, 100 + 5000 - 120);
  assert.ok(c.peak <= peakBefore);
  // Host time standing still for a second and a half (a round's end) is not lateness: the clock re-anchors when it moves again.
  const offBefore = c.off;
  for (let i = 0; i < 90; i++) c = noteArrival(c, 5, 100 + 5000 + 16 + i * 16.7);
  assert.ok(c.stalled);
  assert.ok(Math.abs(c.off - offBefore) < 1e-9);
  c = noteArrival(c, 5 + 1 / 60, 100 + 5000 + 1520 + 1000 / 60);
  assert.ok(!c.stalled);
  assert.ok(Math.abs(c.off - (100 + 1520)) < 1e-6); // the host's clock now sits 1.5 s further behind the wall, and that is all
  assert.ok(c.peak <= peakBefore);
  // A break in host time (a new match) starts the clock afresh.
  const fresh = noteArrival(c, 0.5, 9000);
  assert.equal(fresh.n, 1);
  assert.equal(fresh.peak, 0);
});

test('render clock: the view\'s clock never jumps or runs backwards, catches up within a quarter, and holds a little past the newest', () => {
  const dt = 1 / 60;
  // Sitting exactly on target it advances at real time.
  assert.ok(Math.abs(advanceRenderClock(10, 10, dt, 10.1) - (10 + dt)) < 1e-9);
  // Well behind the target (after a stall) it runs at most a quarter fast; well ahead, at most a quarter slow, never backwards.
  assert.ok(Math.abs(advanceRenderClock(10, 10.4, dt, 11) - (10 + dt * 1.25)) < 1e-9);
  assert.ok(Math.abs(advanceRenderClock(10, 9.6, dt, 11) - (10 + dt * 0.75)) < 1e-9);
  assert.ok(advanceRenderClock(10, 9.6, dt, 11) > 10);
  // A late packet that moves the target by 20 ms moves the clock by a few percent of a frame, not 20 ms.
  const nudged = advanceRenderClock(10, 10 + dt - 0.02, dt, 11);
  assert.ok(Math.abs(nudged - (10 + dt)) < dt * 0.05);
  // It never runs past what has arrived plus the carry.
  assert.equal(advanceRenderClock(10.05, 10.2, dt, 10), 10 + EXTRAPOLATE_MAX);
  // A break of more than half a second starts it afresh, at the target.
  assert.equal(advanceRenderClock(10, 20, dt, 25), 20);
  assert.equal(advanceRenderClock(null, 5, dt, 6), 5);
});
