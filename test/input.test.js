import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinToTurn, travelSpin, aimTurn, MOUSE_SENS, WHEEL_STEP, MOUSE_TURN_RATE, SPIN_BACKLOG_SECONDS, AIM_GAIN, AIM_SETTLE } from '../src/input.js';

test('mouse turn: a small travel turns by exactly that much, a flick is paced to the frame\'s rate and the rest carried', () => {
  const dt = 1 / 60;
  // A twentieth of a radian (five pixels), inside one frame's room (a twelfth): all of it this frame.
  const small = spinToTurn(0.05, dt);
  assert.ok(Math.abs(small.turn * MOUSE_TURN_RATE * dt - 0.05) < 1e-9);
  assert.equal(small.left, 0);
  // Leftwards is counter-clockwise: the turn goes negative.
  assert.ok(spinToTurn(-0.05, dt).turn < 0);
  // A flick of forty pixels is more than a frame can turn: full rate now, the rest kept for the next frame.
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

test('mouse turn: a flick is carried for a quarter second of turning and only a wild sweep past that is cut', () => {
  const rate = 7;
  const backlog = rate * SPIN_BACKLOG_SECONDS;
  // A hundred degrees of flick at 60 Hz: none of it is thrown away.
  const flick = spinToTurn((100 * Math.PI) / 180, 1 / 60, rate);
  assert.equal(flick.turn, 1);
  assert.ok(flick.left < backlog);
  assert.ok(Math.abs(flick.left - ((100 * Math.PI) / 180 - rate / 60)) < 1e-9);
  // A wild sweep is cut to the backlog, the same both ways round.
  const r = spinToTurn(20, 1 / 60, rate);
  assert.equal(r.left, backlog);
  assert.equal(spinToTurn(-20, 1 / 60, rate).left, -backlog);
  // The backlog follows the frame's rate, so a slow gyro is never owed more seconds of turning than a fast one.
  assert.ok(Math.abs(spinToTurn(20, 1 / 60, 5.6).left - 5.6 * SPIN_BACKLOG_SECONDS) < 1e-12);
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

test('mouse travel: right and back turn clockwise, left and forward counter-clockwise, and the two add up; sideways-only ignores forward and back; speed scales it', () => {
  assert.ok(travelSpin(10, 0) > 0);
  assert.ok(travelSpin(-10, 0) < 0);
  assert.ok(travelSpin(0, 10) > 0); // back (down the screen) is clockwise, like right
  assert.ok(travelSpin(0, -10) < 0); // forward (up the screen) is counter-clockwise, like left
  assert.ok(Math.abs(travelSpin(10, 0) - 10 * MOUSE_SENS) < 1e-12);
  assert.ok(Math.abs(travelSpin(10, 10) - 20 * MOUSE_SENS) < 1e-12);
  assert.equal(travelSpin(10, -10), 0); // right and forward cancel
  assert.equal(travelSpin(0, 10, false), 0); // sideways only: back turns nothing
  assert.ok(Math.abs(travelSpin(10, 7, false) - 10 * MOUSE_SENS) < 1e-12);
  assert.ok(Math.abs(travelSpin(10, 0, true, 1.5) - 15 * MOUSE_SENS) < 1e-12);
  // A full turn in about 630 px at speed 1.
  assert.ok(Math.abs((2 * Math.PI) / MOUSE_SENS - 628) < 1);
});

test('aim: the frame turns the short way to the cursor, at full rate while far, a share of the rest when near, and stops when there', () => {
  const dt = 1 / 60;
  const rate = 7;
  // A quarter turn is more than a frame's worth: full rate, clockwise.
  assert.equal(aimTurn(0, Math.PI / 2, rate, dt), 1);
  assert.equal(aimTurn(0, -Math.PI / 2, rate, dt), -1);
  // From 170 degrees to -170 degrees is 20 degrees on through 180, not 340 back.
  assert.equal(aimTurn((170 * Math.PI) / 180, (-170 * Math.PI) / 180, rate, dt), 1);
  // Near, the command is the gain's share of the way, so the spin's own ramp never carries the frame past.
  const near = aimTurn(1, 1.05, rate, dt);
  assert.ok(Math.abs(near * rate * dt - AIM_GAIN * 0.05) < 1e-9);
  // Within a thirtieth of a degree it has arrived.
  assert.equal(aimTurn(1, 1 + AIM_SETTLE / 2, rate, dt), 0);
  // A stalled frame (dt 0) never divides by zero.
  assert.equal(aimTurn(0, 1, rate, 0), 1);
});
