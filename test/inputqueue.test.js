import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputQueue, inputRecord, splitAck, MIN_BUFFER, BUFFER_GROWTH, CATCH_UP_OVER, TRIM_OVER, REDUNDANCY } from '../src/inputqueue.js';
import { PHYSICS_DT } from '../src/config.js';

const it = (mx, extra = {}) => ({ mx, my: 0, turn: 0, lunge: false, retract: false, ...extra });
const rec = (seq, n, intent, vt = null) => inputRecord(seq, n, intent, vt);

test('input queue: records play in order, each for exactly its steps, and the ack says how far the host has got', () => {
  const q = new InputQueue();
  q.push([rec(1, 4, it(1)), rec(2, 3, it(-1))]);
  const played = [];
  for (let i = 0; i < 7; i++) {
    const out = q.next();
    assert.equal(out.length, 1);
    played.push(out[0].intent.mx);
    if (i === 1) assert.deepEqual(q.ackPair(), [0, 2]); // two steps into record 1
    if (i === 3) assert.deepEqual(q.ackPair(), [1, 0]); // record 1 done
  }
  assert.deepEqual(played, [1, 1, 1, 1, -1, -1, -1]);
  assert.deepEqual(q.ackPair(), [2, 0]);
});

test('input queue: repeats and records out of order are taken once, in sequence order, so resending the last few costs nothing', () => {
  const q = new InputQueue();
  assert.equal(q.push([rec(2, 4, it(2)), rec(1, 4, it(1))]), 2);
  assert.equal(q.push([rec(1, 4, it(1)), rec(2, 4, it(2)), rec(3, 4, it(3))]), 1);
  const seq = [];
  for (let i = 0; i < 12; i++) seq.push(q.next()[0].intent.mx);
  assert.deepEqual(seq, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.ok(REDUNDANCY >= 3);
});

test('input queue: run dry, the character waits (nothing is guessed), the cushion grows, and play resumes once it is refilled', () => {
  const q = new InputQueue();
  q.push([rec(1, 4, it(1))]);
  for (let i = 0; i < 4; i++) assert.equal(q.next().length, 1);
  assert.deepEqual(q.next(), []); // dry: wait
  assert.equal(q.buffer, MIN_BUFFER + BUFFER_GROWTH);
  q.push([rec(2, 4, it(2))]);
  assert.deepEqual(q.next(), []); // four queued, the cushion is now eight: still waiting
  q.push([rec(3, 4, it(3))]);
  const out = q.next();
  assert.equal(out.length, 1);
  assert.equal(out[0].intent.mx, 2); // nothing was skipped
  assert.equal(q.stats.starved, 1);
});

test('input queue: after a stall it catches up two steps at a time, playing every step, and the cushion shrinks again when calm', () => {
  const q = new InputQueue();
  const recs = [];
  for (let s = 1; s <= 10; s++) recs.push(rec(s, 4, it(s)));
  q.push(recs); // forty steps at once, far past the cushion
  let steps = 0;
  let doubles = 0;
  const seen = [];
  while (q.depth > 0) {
    const out = q.next();
    if (out.length === 2) doubles++;
    for (const o of out) seen.push(o.intent.mx);
    steps++;
  }
  assert.equal(seen.length, 40);
  assert.deepEqual([...new Set(seen)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(doubles > 0 && steps < 40);
  assert.ok(40 - MIN_BUFFER - CATCH_UP_OVER <= doubles * 2 + 2);
  // Calm for long enough, a grown cushion comes down a step.
  const calm = new InputQueue();
  calm.buffer = 20;
  const first = [];
  for (let s = 1; s <= 5; s++) first.push(rec(s, 4, it(0)));
  calm.push(first);
  // A steady stream: one step arrives for every step played, and the queue never runs dry.
  for (let i = 0; i < 260; i++) {
    calm.push([rec(6 + i, 1, it(0))]);
    calm.next();
  }
  assert.equal(calm.stats.starved, 0);
  assert.ok(calm.buffer < 20);
});

test('input queue: a queue far too deep is trimmed, and a thrust among the steps trimmed still happens on the next step played', () => {
  const q = new InputQueue();
  const recs = [];
  for (let s = 1; s <= 40; s++) recs.push(rec(s, 4, it(0, s === 3 ? { lunge: true } : {})));
  q.push(recs); // 160 steps, past the trim limit
  assert.ok(q.depth <= q.buffer);
  assert.ok(q.stats.trimmed > 0);
  assert.ok(160 > MIN_BUFFER + TRIM_OVER);
  const first = q.next();
  assert.equal(first[0].intent.lunge, true);
  assert.equal(q.stats.latched, 1);
});

test("input queue: each step is paired with its share of the frame's view time, so rewinds sweep the ball step by step", () => {
  const q = new InputQueue();
  q.push([rec(1, 4, it(0), 10)]);
  const vts = [];
  for (let i = 0; i < 4; i++) vts.push(q.next()[0].vt);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(vts[i] - (10 - (3 - i) * PHYSICS_DT)) < 1e-9);
  q.push([rec(2, 4, it(0), null)]);
  assert.equal(q.next()[0].vt, null); // a guest that asked for no compensation
});

test('input queue: a new round empties the queue and the cushion but keeps counting, and the guest replays exactly what the ack leaves', () => {
  const q = new InputQueue();
  q.push([rec(1, 4, it(1)), rec(2, 4, it(1))]);
  q.next();
  q.newRound();
  assert.equal(q.depth, 0);
  assert.equal(q.push([rec(2, 4, it(1))]), 0); // an old record from before the new round is not taken again
  assert.equal(q.push([rec(3, 4, it(1))]), 1);
  // The guest: steps tagged with their record; [2, 3] means records to 2 are done and three steps of the next.
  const steps = [1, 1, 2, 2, 3, 3, 3, 3, 4, 4].map((seq, i) => ({ seq, i }));
  const { keep, replay } = splitAck(steps, [2, 3]);
  assert.deepEqual(keep.map((s) => s.i), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(replay.map((s) => s.i), [7, 8, 9]);
  // An older host's bare number still works.
  assert.deepEqual(splitAck(steps, 3).replay.map((s) => s.i), [8, 9]);
});
