import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinToTurn, MOUSE_SENS, WHEEL_STEP, MOUSE_TURN_RATE, SPIN_BACKLOG } from '../src/input.js';

test('mouse turn: a small travel turns by exactly that much, a flick is paced to the frame\'s rate and the rest carried', () => {
  const dt = 1 / 60;
  // Five pixels to the right: a twentieth of a radian, inside one frame's room (a twelfth), all of it this frame.
  const small = spinToTurn(5 * MOUSE_SENS, dt);
  assert.ok(Math.abs(small.turn * MOUSE_TURN_RATE * dt - 5 * MOUSE_SENS) < 1e-9);
  assert.equal(small.left, 0);
  // Leftwards is counter-clockwise: the turn goes negative.
  assert.ok(spinToTurn(-5 * MOUSE_SENS, dt).turn < 0);
  // A flick of 40 px is more than a frame can turn: full rate now, the rest kept for the next frame.
  const flick = spinToTurn(40 * MOUSE_SENS, dt);
  assert.equal(flick.turn, 1);
  assert.ok(Math.abs(flick.left - (40 * MOUSE_SENS - MOUSE_TURN_RATE * dt)) < 1e-9);
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

test('mouse turn: a wild sweep is cut to the backlog, so the frame never spins on after the hand has stopped', () => {
  const r = spinToTurn(2000 * MOUSE_SENS, 1 / 60);
  assert.equal(r.turn, 1);
  assert.equal(r.left, SPIN_BACKLOG);
  assert.equal(spinToTurn(-2000 * MOUSE_SENS, 1 / 60).left, -SPIN_BACKLOG);
  // The backlog is a fraction of a second at full rate.
  assert.ok(SPIN_BACKLOG / MOUSE_TURN_RATE < 0.2);
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
