import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGameState, rebuildWalls } from '../src/gamestate.js';
import { buildSnapshot, applySnapshot } from '../src/netstate.js';
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

    // Third wheel is refused.
    stranger.send({ t: 'join', code: created.code, name: 'Nobody' });
    assert.equal((await stranger.next()).t, 'error');

    // Relay both directions, payload untouched.
    host.send({ t: 's', ball: [1.5, 2, 3, 4, 0], f: [], mv: [] });
    const snap = await guest.next();
    assert.deepEqual(snap.ball, [1.5, 2, 3, 4, 0]);
    guest.send({ t: 'i', mx: 0.5, my: -1, turn: 1, lunge: 1, retract: 0 });
    const intent = await host.next();
    assert.equal(intent.mx, 0.5);

    // Ping round trip.
    guest.send({ t: 'ping', ts: 42 });
    const ping = await host.next();
    assert.equal(ping.t, 'ping');
    host.send({ t: 'pong', ts: ping.ts });
    assert.equal((await guest.next()).t, 'pong');

    // Guest leaving tells the host.
    guest.ws.close();
    const left = await host.next();
    assert.equal(left.t, 'peer-left');
    host.ws.close();
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
