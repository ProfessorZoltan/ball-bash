import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinToTurn, arcTurn, WHEEL_STEP, MOUSE_TURN_RATE, SPIN_BACKLOG } from '../src/input.js';

test('mouse turn: a small travel turns by exactly that much, a flick is paced to the frame\'s rate and the rest carried', () => {
  const dt = 1 / 60;
  // A twentieth of a radian of arc, inside one frame's room (a twelfth): all of it this frame.
  const small = spinToTurn(0.05, dt);
  assert.ok(Math.abs(small.turn * MOUSE_TURN_RATE * dt - 0.05) < 1e-9);
  assert.equal(small.left, 0);
  // A counter-clockwise arc turns the other way.
  assert.ok(spinToTurn(-0.05, dt).turn < 0);
  // Four tenths of a radian is more than a frame can turn: full rate now, the rest kept for the next frame.
  const flick = spinToTurn(0.4, dt);
  assert.equal(flick.turn, 1);
  assert.ok(Math.abs(flick.left - (0.4 - MOUSE_TURN_RATE * dt)) < 1e-9);
  // Frame after frame the flick is used up.
  let left = flick.left;
  let frames = 0;
  while (left > 0 && frames < 20) {
    left = spinToTurn(left, dt).left;
    frames++;
  }
  assert.equal(left, 0);
  assert.ok(frames >= 1 && frames <= 4);
});

test('mouse turn: an arc drawn far faster than the frame can turn is cut to the backlog, so the frame never spins on long after the hand has stopped', () => {
  const r = spinToTurn(20, 1 / 60);
  assert.equal(r.turn, 1);
  assert.equal(r.left, SPIN_BACKLOG);
  assert.equal(spinToTurn(-20, 1 / 60).left, -SPIN_BACKLOG);
  // The backlog is a fraction of a second at full rate.
  assert.ok(SPIN_BACKLOG / MOUSE_TURN_RATE < 0.3);
});

test('mouse turn: a wheel notch is a fixed step, one frame at a slow display is paced the same as at a fast one', () => {
  assert.ok(Math.abs(WHEEL_STEP - Math.PI / 12) < 1e-12);
  // A notch (15 degrees) at 60 Hz takes a few frames; at 240 Hz it takes four times as many, at the same rate.
  const drain = (dt) => {
    let left = WHEEL_STEP;
    let n = 0;
    while (left > 1e-9 && n < 100) {
      left = spinToTurn(left, dt).left;
      n++;
    }
    return n;
  };
  assert.equal(drain(1 / 60), 4);
  assert.equal(drain(1 / 240), 13);
  // A stalled frame (dt 0) still turns by at least a physics step's worth, never divides by zero.
  const stalled = spinToTurn(0.1, 0);
  assert.ok(Number.isFinite(stalled.turn) && stalled.turn === 1);
});

test('arc: a path that bends turns the frame by the bend, the same way round; a straight path, a reversal and a new stroke turn nothing', () => {
  const walk = (segments) => {
    let heading = null;
    let total = 0;
    for (const [x, y] of segments) {
      const r = arcTurn(heading, x, y);
      heading = r.heading;
      total += r.turn;
    }
    return total;
  };
  // A square drawn clockwise on screen (right, down, left, up): three right-angle bends after the first segment.
  assert.ok(Math.abs(walk([[10, 0], [0, 10], [-10, 0], [0, -10]]) - (3 * Math.PI) / 2) < 1e-9);
  // The same square the other way round turns the other way.
  assert.ok(Math.abs(walk([[10, 0], [0, -10], [-10, 0], [0, 10]]) + (3 * Math.PI) / 2) < 1e-9);
  // Twelve chords of a circle turn a full circle less the first chord, whatever the radius.
  const circle = (r, n) => Array.from({ length: n }, (_, i) => [r * (Math.cos(((i + 1) * 2 * Math.PI) / n) - Math.cos((i * 2 * Math.PI) / n)), r * (Math.sin(((i + 1) * 2 * Math.PI) / n) - Math.sin((i * 2 * Math.PI) / n))]);
  assert.ok(Math.abs(walk(circle(30, 12)) - (2 * Math.PI * 11) / 12) < 1e-9);
  assert.ok(Math.abs(walk(circle(300, 12)) - (2 * Math.PI * 11) / 12) < 1e-9);
  // A straight line, however long, turns nothing; a hand going back the way it came is a reversal, not an arc.
  assert.equal(walk([[10, 0], [40, 0], [7, 0]]), 0);
  assert.equal(arcTurn(0, -10, 0.1).turn, 0);
  assert.ok(Math.abs(arcTurn(0, 10, 10).turn - Math.PI / 4) < 1e-9);
  // The first segment of a stroke has nothing to turn from.
  assert.equal(arcTurn(null, 3, 4).turn, 0);
  assert.ok(Math.abs(arcTurn(null, 3, 4).heading - Math.atan2(4, 3)) < 1e-12);
});
